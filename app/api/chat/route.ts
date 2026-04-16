import {
  getOpenRouterModel,
  OPENROUTER_CHAT_COMPLETIONS_URL,
} from '@/lib/config';
import type {
  ChatApiErrorBody,
  ChatApiSuccessBody,
  ChatMessage,
  OpenRouterChatCompletionResponse,
  OpenRouterErrorResponse,
} from '@/lib/types/chat';

export const runtime = 'nodejs';

function jsonError(
  status: number,
  message: string
): Response {
  const body: ChatApiErrorBody = { error: message, status };
  return Response.json(body, { status });
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const role = v.role;
  const content = v.content;
  return (
    (role === 'system' || role === 'user' || role === 'assistant') &&
    typeof content === 'string'
  );
}

function parseRequestMessages(data: unknown): ChatMessage[] | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;

  const hasPrompt = 'prompt' in o;
  const hasMessages = 'messages' in o;
  if (hasPrompt && hasMessages) {
    return null;
  }

  if (hasPrompt) {
    if (typeof o.prompt !== 'string' || !o.prompt.trim()) return null;
    return [{ role: 'user', content: o.prompt.trim() }];
  }

  if (hasMessages) {
    if (!Array.isArray(o.messages) || o.messages.length === 0) return null;
    const msgs: ChatMessage[] = [];
    for (const m of o.messages) {
      if (!isChatMessage(m)) return null;
      msgs.push(m);
    }
    return msgs;
  }

  return null;
}

function getOpenRouterErrorMessage(
  parsed: OpenRouterErrorResponse | OpenRouterChatCompletionResponse
): string | undefined {
  const err = parsed.error;
  if (err && typeof err.message === 'string') return err.message;
  return undefined;
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return jsonError(
      500,
      'Server misconfiguration: OPENROUTER_API_KEY is not set.'
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON body.');
  }

  const messages = parseRequestMessages(raw);
  if (!messages) {
    return jsonError(
      400,
      'Body must include either a non-empty "prompt" string or a non-empty "messages" array.'
    );
  }

  const model = getOpenRouterModel();
  const outbound = { model, messages };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const referer = process.env.OPENROUTER_HTTP_REFERER;
  if (referer) {
    headers['HTTP-Referer'] = referer;
  }
  const title = process.env.OPENROUTER_APP_TITLE;
  if (title) {
    headers['X-Title'] = title;
  }

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(outbound),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error calling OpenRouter.';
    return jsonError(502, msg);
  }

  const rawText = await upstream.text();
  let parsed: unknown;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    return jsonError(
      upstream.status || 502,
      rawText.slice(0, 500) || 'Invalid response from OpenRouter.'
    );
  }

  if (!upstream.ok) {
    const asError = parsed as OpenRouterErrorResponse;
    const msg =
      getOpenRouterErrorMessage(asError) ??
      (typeof rawText === 'string' && rawText
        ? rawText.slice(0, 500)
        : `OpenRouter request failed (${upstream.status}).`);
    return jsonError(upstream.status || 502, msg);
  }

  const completion = parsed as OpenRouterChatCompletionResponse;
  const innerErr = getOpenRouterErrorMessage(completion);
  if (innerErr) {
    return jsonError(502, innerErr);
  }

  const content =
    completion.choices?.[0]?.message?.content ?? undefined;
  if (typeof content !== 'string') {
    return jsonError(502, 'OpenRouter returned no message content.');
  }

  const success: ChatApiSuccessBody = {
    content,
    model: completion.model ?? model,
    id: completion.id,
  };

  return Response.json(success);
}
