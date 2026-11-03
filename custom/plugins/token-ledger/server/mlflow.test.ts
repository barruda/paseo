import assert from 'node:assert/strict';
import test from 'node:test';
import { findTraceUrl } from './mlflow.ts';

function fakeMlflow(traces: unknown[], calls: { url: string; body: any }[] = []) {
  return async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const payload = url.endsWith('/experiments/search')
      ? { experiments: [{ experiment_id: '1' }, { experiment_id: '2' }] }
      : { traces };
    return { ok: true, status: 200, json: async () => payload };
  };
}

const trace = (id: string, at: string, experiment = '1') =>
  ({ trace_id: id, request_time: at, trace_location: { mlflow_experiment: { experiment_id: experiment } } });

test('links the session trace that started closest to the turn', async () => {
  const calls: { url: string; body: any }[] = [];
  const result = await findTraceUrl({
    baseUrl: 'http://localhost:5000/', sessionId: 'abc-123', startedAt: '2026-11-03T18:11:53.300Z',
    fetch: fakeMlflow([trace('tr-early', '2026-11-03T18:10:33.601Z'), trace('tr-turn', '2026-11-03T18:11:53.297Z', '2')], calls),
  });
  assert.deepEqual(result, {
    status: 'found',
    url: 'http://localhost:5000/#/experiments/2/traces?selectedEvaluationId=tr-turn&startTimeLabel=ALL',
  });
  const search = calls[1].body;
  assert.equal(search.locations.length, 2);
  assert.match(search.filter, /metadata\.`mlflow\.trace\.session` = 'abc-123'/);
});

test('reports a missing trace when none started near the turn', async () => {
  const result = await findTraceUrl({
    baseUrl: 'http://localhost:5000', sessionId: 'abc', startedAt: '2026-11-03T18:11:53.300Z',
    fetch: fakeMlflow([trace('tr-far', '2026-11-03T17:00:00.000Z')]),
  });
  assert.deepEqual(result, { status: 'missing' });
});

test('never puts an unexpected session id into the MLflow filter', async () => {
  let called = false;
  const result = await findTraceUrl({
    baseUrl: 'http://localhost:5000', sessionId: "x' OR '1'='1", startedAt: '2026-11-03T18:11:53.300Z',
    fetch: async () => { called = true; throw new Error('unreachable'); },
  });
  assert.deepEqual(result, { status: 'missing' });
  assert.equal(called, false);
});

test('an empty address turns the lookup off, and a down server is an error', async () => {
  assert.deepEqual(await findTraceUrl({ baseUrl: ' ', sessionId: 'abc', startedAt: '2026-11-03T18:11:53Z' }), { status: 'disabled' });
  const down = await findTraceUrl({
    baseUrl: 'http://localhost:5000', sessionId: 'abc', startedAt: '2026-11-03T18:11:53Z',
    fetch: async () => { throw new Error('connect ECONNREFUSED'); },
  });
  assert.deepEqual(down, { status: 'error', message: 'connect ECONNREFUSED' });
});
