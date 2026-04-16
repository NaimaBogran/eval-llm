import {
  getOpenRouterEvalModel,
  OPENROUTER_CHAT_COMPLETIONS_URL,
} from '@/lib/config';
import { createEvalRun, finalizeRun } from '@/lib/langsmith';
import type { EvalCriteria, EvalRequest, EvalResult } from '@/types/eval';
import type { OpenRouterChatCompletionResponse } from '@/lib/types/chat';
import type { RunTree } from 'langsmith/run_trees';

export const runtime = 'nodejs';

const GRADER_SYSTEM_PROMPT = `You are an objective LLM response evaluator. Given a user query and an LLM response, score the response on four criteria, then give an overall accuracy score from 0.0 to 1.0. Respond ONLY with valid JSON — no markdown, no backticks, no explanation outside the JSON — matching exactly this shape:
{
  "score": 0.85,
  "reasoning": "One or two sentences explaining the score.",
  "criteria": {
    "factually_accurate": true,
    "relevant_to_query": true,
    "concise": true,
    "helpful": true
  }
}`;

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

function isEvalCriteria(value: unknown): value is EvalCriteria {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.factually_accurate === 'boolean' &&
    typeof o.relevant_to_query === 'boolean' &&
    typeof o.concise === 'boolean' &&
    typeof o.helpful === 'boolean'
  );
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function parseGraderPayload(raw: unknown): Omit<EvalResult, 'langsmith_run_id' | 'langsmith_url' | 'pass'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const scoreRaw = o.score;
  const reasoning = o.reasoning;
  const criteria = o.criteria;
  if (typeof scoreRaw !== 'number' && typeof scoreRaw !== 'string') return null;
  const scoreNum =
    typeof scoreRaw === 'number' ? scoreRaw : Number.parseFloat(scoreRaw);
  if (typeof reasoning !== 'string' || !isEvalCriteria(criteria)) return null;
  return {
    score: clamp01(scoreNum),
    reasoning,
    criteria,
  };
}

function extractJsonStrings(text: string): string[] {
  const trimmed = text.trim();
  const out: string[] = [trimmed];
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
  if (fence?.[1]) {
    out.push(fence[1].trim());
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    out.push(trimmed.slice(start, end + 1));
  }
  return [...new Set(out)];
}

function tryParseGraderJson(content: string): Omit<EvalResult, 'langsmith_run_id' | 'langsmith_url' | 'pass'> | null {
  for (const candidate of extractJsonStrings(content)) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const inner = parseGraderPayload(parsed);
      if (inner) return inner;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function withLangSmith(
  base: EvalResult,
  run: RunTree | null
): EvalResult {
  if (!run) return base;
  return {
    ...base,
    langsmith_run_id: run.id,
    langsmith_url: `https://smith.langchain.com/public/${run.id}`,
  };
}

function fallbackEval(
  reasoning: string,
  run: RunTree | null
): EvalResult {
  const base: EvalResult = {
    score: 0,
    pass: false,
    reasoning,
    criteria: {
      factually_accurate: false,
      relevant_to_query: false,
      concise: false,
      helpful: false,
    },
  };
  return withLangSmith(base, run);
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return jsonError(500, 'Server misconfiguration: OPENROUTER_API_KEY is not set.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON body.');
  }

  if (!body || typeof body !== 'object') {
    return jsonError(400, 'Invalid request body.');
  }

  const q = (body as Record<string, unknown>).query;
  const r = (body as Record<string, unknown>).response;
  if (typeof q !== 'string' || typeof r !== 'string') {
    return jsonError(400, 'Body must include string fields "query" and "response".');
  }

  const payload: EvalRequest = { query: q, response: r };

  let run: RunTree | null = null;
  try {
    run = await createEvalRun(payload.query, payload.response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[eval] createEvalRun:', message);
  }

  const model = getOpenRouterEvalModel();
  const userMessage = `User query:\n${payload.query}\n\nLLM response to evaluate:\n${payload.response}`;

  const outbound = {
    model,
    messages: [
      { role: 'system' as const, content: GRADER_SYSTEM_PROMPT },
      { role: 'user' as const, content: userMessage },
    ],
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const referer = process.env.OPENROUTER_HTTP_REFERER;
  if (referer) headers['HTTP-Referer'] = referer;
  const title = process.env.OPENROUTER_APP_TITLE;
  if (title) headers['X-Title'] = title;

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(outbound),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error calling OpenRouter.';
    const result = fallbackEval(msg, run);
    try {
      await finalizeRun(run, result, result.score);
    } catch (finalizeErr) {
      const m = finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr);
      console.warn('[eval] finalizeRun:', m);
    }
    return Response.json(result);
  }

  const rawText = await upstream.text();
  let parsedBody: unknown;
  try {
    parsedBody = rawText ? JSON.parse(rawText) : null;
  } catch {
    const result = fallbackEval(
      rawText.slice(0, 500) || 'Invalid response from OpenRouter.',
      run
    );
    await finalizeRun(run, result, result.score);
    return Response.json(result);
  }

  if (!upstream.ok) {
    const errMsg =
      typeof parsedBody === 'object' &&
      parsedBody !== null &&
      'error' in parsedBody &&
      typeof (parsedBody as { error?: { message?: string } }).error?.message ===
        'string'
        ? (parsedBody as { error: { message: string } }).error.message
        : rawText.slice(0, 500) || `OpenRouter request failed (${upstream.status}).`;
    const result = fallbackEval(errMsg, run);
    await finalizeRun(run, result, result.score);
    return Response.json(result);
  }

  const completion = parsedBody as OpenRouterChatCompletionResponse;
  const content = completion.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    const result = fallbackEval('OpenRouter returned no message content.', run);
    await finalizeRun(run, result, result.score);
    return Response.json(result);
  }

  const parsedEval = tryParseGraderJson(content);
  let result: EvalResult;
  if (!parsedEval) {
    result = fallbackEval('Could not parse evaluator JSON output.', run);
  } else {
    const score = clamp01(parsedEval.score);
    const pass = score >= 0.7;
    result = withLangSmith(
      {
        score,
        pass,
        reasoning: parsedEval.reasoning,
        criteria: parsedEval.criteria,
      },
      run
    );
  }

  try {
    await finalizeRun(run, result, result.score);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[eval] finalizeRun:', message);
  }

  return Response.json(result);
}
