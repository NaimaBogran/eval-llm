'use client';

import { useState } from 'react';
import type { ChatApiErrorBody, ChatApiSuccessBody } from '@/lib/types/chat';
import type { EvalCriteria, EvalResult } from '@/types/eval';

type HistoryRow = {
  query: string;
  score: number;
  pass: boolean;
  timestamp: string;
};

const fontSerif = '[font-family:var(--font-lora),Georgia,serif]';

function truncateQuery(text: string, max = 60): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function barColorClass(score: number): string {
  if (score >= 0.8) return 'bg-emerald-400';
  if (score >= 0.6) return 'bg-amber-300';
  return 'bg-rose-400';
}

export default function HomePage() {
  const [query, setQuery] = useState('');
  const [primaryResponse, setPrimaryResponse] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [isPrimaryLoading, setIsPrimaryLoading] = useState(false);
  const [isEvalLoading, setIsEvalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evalFailed, setEvalFailed] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEvalFailed(false);
    setEvalResult(null);
    setPrimaryResponse(null);

    const q = query.trim();
    if (!q) return;

    setIsPrimaryLoading(true);
    setIsEvalLoading(false);

    let assistantText: string;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: q }),
      });

      const data: unknown = await res.json();

      if (!res.ok) {
        const errBody = data as ChatApiErrorBody;
        setError(errBody.error ?? res.statusText ?? 'Request failed.');
        return;
      }

      const success = data as ChatApiSuccessBody;
      if (typeof success.content !== 'string') {
        setError('Unexpected response from server.');
        return;
      }

      assistantText = success.content;
      setPrimaryResponse(assistantText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(msg);
      return;
    } finally {
      setIsPrimaryLoading(false);
    }

    setIsEvalLoading(true);

    try {
      // EVAL INTEGRATION POINT — programmatic callers can POST /api/eval with the same JSON body.
      const eres = await fetch('/api/eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q,
          response: assistantText,
        }),
      });

      const evalJson: unknown = await eres.json();

      if (!eres.ok) {
        setEvalFailed(true);
        return;
      }

      const maybe = evalJson as EvalResult;
      if (
        typeof maybe.score !== 'number' ||
        typeof maybe.pass !== 'boolean' ||
        typeof maybe.reasoning !== 'string' ||
        !maybe.criteria
      ) {
        setEvalFailed(true);
        return;
      }

      setEvalResult(maybe);
      setHistory((prev) =>
        [
          {
            query: truncateQuery(q),
            score: maybe.score,
            pass: maybe.pass,
            timestamp: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 10)
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Eval request failed.';
      console.warn('[eval]', msg);
      setEvalFailed(true);
    } finally {
      setIsEvalLoading(false);
    }
  }

  const scorePercent =
    evalResult !== null ? Math.round(evalResult.score * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-10 border-b border-stone-200/80 pb-8">
        <h1
          className={`${fontSerif} text-3xl font-semibold tracking-tight text-stone-900`}
        >
          LLM eval playground
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
          Primary model response and automated quality eval—document-style on the
          left, scores on the right.
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
        {/* Left: paper column + indigo rule */}
        <section className="flex flex-col gap-6">
          <div className="rounded-2xl border border-stone-200/90 bg-[#fafaf9] p-6 shadow-sm">
            <div className="border-l-4 border-indigo-500 pl-5">
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <label
                  htmlFor="query"
                  className={`${fontSerif} text-sm font-semibold text-stone-800`}
                >
                  Query
                </label>
                <textarea
                  id="query"
                  name="query"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Enter your question…"
                  required
                  disabled={isPrimaryLoading || isEvalLoading}
                  rows={5}
                  className="w-full rounded-xl border border-stone-300/90 bg-white px-4 py-3 text-sm leading-relaxed text-stone-800 shadow-inner outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={
                    isPrimaryLoading || isEvalLoading || !query.trim()
                  }
                  className="inline-flex w-fit items-center justify-center rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-200/60 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPrimaryLoading || isEvalLoading ? 'Working…' : 'Run eval'}
                </button>
              </form>

              <div className="mt-8">
                <h2
                  className={`${fontSerif} text-sm font-semibold text-stone-800`}
                >
                  Primary response
                </h2>
                <div className="mt-3 min-h-[9rem] rounded-xl border border-stone-200 bg-white p-4 text-sm leading-[1.7] text-stone-800 shadow-inner">
                  {isPrimaryLoading ? (
                    <div className="space-y-2.5 animate-pulse">
                      <div className="h-3 w-full rounded bg-stone-200" />
                      <div className="h-3 w-[92%] rounded bg-stone-200" />
                      <div className="h-3 w-4/5 rounded bg-stone-200" />
                    </div>
                  ) : error ? (
                    <p className="text-sm font-medium text-rose-700">{error}</p>
                  ) : primaryResponse ? (
                    <p className={`${fontSerif} whitespace-pre-wrap`}>
                      {primaryResponse}
                    </p>
                  ) : (
                    <p className="text-sm text-stone-400">
                      No response yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right: floating eval card */}
        <section className="flex flex-col gap-3 lg:sticky lg:top-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            Evaluation
          </h2>

          <div className="min-h-[14rem] rounded-2xl border border-indigo-100/80 bg-white p-6 shadow-2xl shadow-indigo-200/40 ring-1 ring-indigo-50">
            {isEvalLoading ? (
              <div className="space-y-5 animate-pulse">
                <div className="h-12 w-28 rounded-xl bg-indigo-100" />
                <div className="h-2.5 w-full rounded-full bg-stone-100" />
                <div className="flex gap-2">
                  <div className="h-7 w-20 rounded-full bg-emerald-100" />
                  <div className="h-7 w-16 rounded-full bg-rose-100" />
                </div>
                <div className="h-4 w-full rounded bg-stone-100" />
                <div className="h-4 w-4/5 rounded bg-stone-100" />
              </div>
            ) : evalFailed ? (
              <p className="text-sm font-medium text-amber-800">
                Eval unavailable
              </p>
            ) : evalResult ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="text-4xl font-bold tabular-nums text-indigo-600">
                    {scorePercent}%
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                      evalResult.pass
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-rose-200 bg-rose-50 text-rose-800'
                    }`}
                  >
                    {evalResult.pass ? 'Pass' : 'Fail'}
                  </span>
                </div>

                <div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-stone-100">
                    <div
                      className={`h-full rounded-full transition-all ${barColorClass(
                        evalResult.score
                      )}`}
                      style={{ width: `${scorePercent}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {(Object.keys(evalResult.criteria) as (keyof EvalCriteria)[]).map(
                    (key) => (
                      <span
                        key={key}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                          evalResult.criteria[key]
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-rose-200 bg-rose-50 text-rose-800'
                        }`}
                      >
                        {key}
                      </span>
                    )
                  )}
                </div>

                <p className="text-sm leading-relaxed text-stone-700">
                  {evalResult.reasoning}
                </p>

                {evalResult.langsmith_url ? (
                  <a
                    href={evalResult.langsmith_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-xs font-semibold text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800"
                  >
                    View in LangSmith
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-stone-400">
                Run a query to see the evaluator score here.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Session history — indigo header bar */}
      <section className="mt-14">
        <h2 className={`${fontSerif} mb-4 text-lg font-semibold text-stone-900`}>
          Session history
        </h2>
        <p className="mb-3 text-xs text-stone-500">Last 10 runs this session</p>
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-md">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="bg-indigo-600 text-xs font-semibold uppercase tracking-wide text-white">
              <tr>
                <th className="px-4 py-3">Query</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Pass / Fail</th>
                <th className="px-4 py-3">Timestamp</th>
              </tr>
            </thead>
            <tbody className="text-stone-800">
              {history.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-sm text-stone-400"
                  >
                    No runs yet this session.
                  </td>
                </tr>
              ) : (
                history.map((row, i) => (
                  <tr
                    key={`${row.timestamp}-${i}`}
                    className="border-t border-stone-100 odd:bg-stone-50/80"
                  >
                    <td className="max-w-[14rem] truncate px-4 py-3">
                      {row.query}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-indigo-700">
                      {Math.round(row.score * 100)}%
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                          row.pass
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-rose-200 bg-rose-50 text-rose-800'
                        }`}
                      >
                        {row.pass ? 'Pass' : 'Fail'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {new Date(row.timestamp).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
