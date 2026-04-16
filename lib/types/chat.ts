/** Single message in a chat completion request (OpenAI-compatible). */
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/**
 * POST /api/chat body. Use `prompt` for a single user turn, or `messages` for full context.
 */
export type ChatApiRequestBody =
  | { prompt: string; messages?: undefined }
  | { messages: ChatMessage[]; prompt?: undefined };

/** Successful JSON from POST /api/chat (non-streaming). */
export type ChatApiSuccessBody = {
  content: string;
  model: string;
  id?: string;
};

/** Error JSON from POST /api/chat. */
export type ChatApiErrorBody = {
  error: string;
  status?: number;
};

export type ChatApiResponseBody = ChatApiSuccessBody | ChatApiErrorBody;

export function isChatApiErrorBody(
  body: unknown
): body is ChatApiErrorBody {
  if (body === null || typeof body !== 'object') return false;
  const e = (body as Record<string, unknown>).error;
  return typeof e === 'string';
}

/** Outbound body to OpenRouter chat completions (minimal subset). */
export type OpenRouterChatRequest = {
  model: string;
  messages: ChatMessage[];
};

/** OpenRouter / OpenAI-style completion response (subset we read). */
export type OpenRouterChatCompletionResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { role?: string; content?: string | null };
    finish_reason?: string | null;
  }>;
  error?: { message?: string; code?: number | string };
};

/** Error payloads OpenRouter may return as JSON on failure. */
export type OpenRouterErrorResponse = {
  error?: { message?: string; code?: number | string };
};
