// CUSTOM(token-ledger-trace): MLflow's Claude Code and Codex tracing hooks write one trace per
// turn, tagged with the provider session id. The ledger record has the same session id and the
// turn's start time, so the turn's trace is the session's trace that started closest to it.
import type { TraceLookup } from '../shared/trace.ts';

/** Trace and turn start come from different processes; real pairs differ by milliseconds. */
export const TRACE_MATCH_WINDOW_MS = 120_000;

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type Experiment = { experiment_id?: unknown };
type Trace = { trace_id?: unknown; request_time?: unknown; trace_location?: { mlflow_experiment?: { experiment_id?: unknown } } };

// The filter is MLflow's own query language; only plain ids go into it.
const SESSION_ID = /^[A-Za-z0-9._:-]{1,200}$/;

async function post(fetchImpl: Fetch, url: string, body: unknown): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`MLflow answered HTTP ${response.status}`);
  return response.json();
}

export async function findTraceUrl(input: {
  baseUrl: string; sessionId: string; startedAt: string; fetch?: Fetch;
}): Promise<TraceLookup> {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) return { status: 'disabled' };
  const start = Date.parse(input.startedAt);
  if (!SESSION_ID.test(input.sessionId) || Number.isNaN(start)) return { status: 'missing' };
  const fetchImpl = input.fetch ?? (globalThis.fetch as unknown as Fetch);
  try {
    const listed = await post(fetchImpl, `${baseUrl}/api/2.0/mlflow/experiments/search`, { max_results: 1000 }) as { experiments?: Experiment[] };
    const experimentIds = (listed.experiments ?? []).map((e) => e.experiment_id).filter((id): id is string => typeof id === 'string');
    if (experimentIds.length === 0) return { status: 'missing' };
    const filter = [
      `metadata.\`mlflow.trace.session\` = '${input.sessionId}'`,
      `trace.timestamp_ms >= ${start - TRACE_MATCH_WINDOW_MS}`,
      `trace.timestamp_ms <= ${start + TRACE_MATCH_WINDOW_MS}`,
    ].join(' AND ');
    const found = await post(fetchImpl, `${baseUrl}/api/3.0/mlflow/traces/search`, {
      locations: experimentIds.map((experiment_id) => ({ type: 'MLFLOW_EXPERIMENT', mlflow_experiment: { experiment_id } })),
      filter, max_results: 100,
    }) as { traces?: Trace[] };
    let best: { traceId: string; experimentId: string; distance: number } | null = null;
    for (const trace of found.traces ?? []) {
      const traceId = trace.trace_id;
      const experimentId = trace.trace_location?.mlflow_experiment?.experiment_id;
      const at = typeof trace.request_time === 'string' ? Date.parse(trace.request_time) : Number.NaN;
      if (typeof traceId !== 'string' || typeof experimentId !== 'string' || Number.isNaN(at)) continue;
      const distance = Math.abs(at - start);
      if (distance <= TRACE_MATCH_WINDOW_MS && (!best || distance < best.distance)) best = { traceId, experimentId, distance };
    }
    if (!best) return { status: 'missing' };
    const params = new URLSearchParams({ selectedEvaluationId: best.traceId, startTimeLabel: 'ALL' });
    return { status: 'found', url: `${baseUrl}/#/experiments/${encodeURIComponent(best.experimentId)}/traces?${params}` };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
