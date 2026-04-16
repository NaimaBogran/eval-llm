/**
 * Eval / automation integration: call the same POST /api/chat contract the UI uses.
 * Use from scripts, tests, or eval runners with `baseUrl` (e.g. http://localhost:3000).
 * Stable contract: @/app/api/chat/route.ts
 */

import type { ChatApiRequestBody } from '@/lib/types/chat';
import {
  isChatApiErrorBody,
  type ChatApiSuccessBody,
} from '@/lib/types/chat';

export type CallChatApiResult =
  | { ok: true; data: ChatApiSuccessBody }
  | { ok: false; error: string; status: number };

function joinUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${trimmed}${p}`;
}

export async function callChatApi(
  baseUrl: string,
  body: ChatApiRequestBody
): Promise<CallChatApiResult> {
  const url = joinUrl(baseUrl, '/api/chat');
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Request failed.';
    return { ok: false, error: msg, status: 0 };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return {
      ok: false,
      error: res.statusText || 'Invalid JSON response from /api/chat.',
      status: res.status,
    };
  }

  if (typeof parsed === 'object' && parsed !== null && isChatApiErrorBody(parsed)) {
    return {
      ok: false,
      error: parsed.error,
      status: parsed.status ?? res.status,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      error:
        typeof parsed === 'object' &&
        parsed !== null &&
        'error' in parsed &&
        typeof (parsed as { error: unknown }).error === 'string'
          ? (parsed as { error: string }).error
          : res.statusText || 'Request failed.',
      status: res.status,
    };
  }

  const data = parsed as ChatApiSuccessBody;
  if (typeof data.content !== 'string' || typeof data.model !== 'string') {
    return {
      ok: false,
      error: 'Malformed success payload from /api/chat.',
      status: res.status,
    };
  }

  return { ok: true, data };
}
