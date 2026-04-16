import { Client } from 'langsmith';
import { RunTree } from 'langsmith/run_trees';
import type { EvalResult } from '@/types/eval';

const DEFAULT_PROJECT = 'llm-eval-playground';

function getProjectName(): string {
  return process.env.LANGSMITH_PROJECT ?? DEFAULT_PROJECT;
}

/**
 * LangSmith client; `null` when LANGSMITH_API_KEY is not set (eval still works without tracing).
 */
export const langsmithClient: Client | null =
  typeof process.env.LANGSMITH_API_KEY === 'string' &&
  process.env.LANGSMITH_API_KEY.length > 0
    ? new Client({ apiKey: process.env.LANGSMITH_API_KEY })
    : null;

/**
 * Start a LangSmith trace for an eval run. Returns `null` if LangSmith is unavailable.
 */
export async function createEvalRun(
  query: string,
  response: string
): Promise<RunTree | null> {
  try {
    if (!langsmithClient) {
      console.warn(
        '[LangSmith] LANGSMITH_API_KEY is not set; skipping trace creation.'
      );
      return null;
    }

    const run = new RunTree({
      name: 'llm-response-eval',
      run_type: 'chain',
      project_name: getProjectName(),
      inputs: { query, response },
      client: langsmithClient,
      tracingEnabled: process.env.LANGSMITH_TRACING === 'true',
    });

    await run.postRun();
    return run;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[LangSmith] createEvalRun failed:', message);
    return null;
  }
}

/**
 * End the run with outputs and record feedback score under key `accuracy`.
 */
export async function finalizeRun(
  run: RunTree | null,
  result: EvalResult,
  score: number
): Promise<void> {
  try {
    if (!run || !langsmithClient) {
      return;
    }

    await run.end({
      score: result.score,
      pass: result.pass,
      reasoning: result.reasoning,
      criteria: result.criteria,
    });

    await langsmithClient.createFeedback(run.id, 'accuracy', {
      score,
      comment: 'Auto-graded by evaluator LLM',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[LangSmith] finalizeRun failed:', message);
  }
}
