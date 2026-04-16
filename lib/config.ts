/**
 * Central place to swap the default model (override with OPENROUTER_MODEL in .env.local).
 */
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';

export const OPENROUTER_CHAT_COMPLETIONS_URL =
  'https://openrouter.ai/api/v1/chat/completions';

export function getOpenRouterModel(): string {
  return process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
}

/** Evaluator / grader model (OpenRouter). */
export const DEFAULT_OPENROUTER_EVAL_MODEL = 'openai/gpt-4o-mini';

export function getOpenRouterEvalModel(): string {
  return process.env.OPENROUTER_EVAL_MODEL ?? DEFAULT_OPENROUTER_EVAL_MODEL;
}
