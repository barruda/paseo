import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaseoApi, PaseoAgentTimelineEvent } from '@getpaseo/client';
import { TimelineSubscriptions } from './subscriptions.ts';

test('post-ready timeline errors release, retry, reconcile and ignore events from stale handles', async () => {
  const listeners: Array<(event: PaseoAgentTimelineEvent) => void> = [];
  let releases = 0;
  let restored = 0;
  let gaps = 0;
  let events = 0;
  const paseo = { agents: { ref: () => ({ timeline: { subscribe: (handler: typeof listeners[number]) => {
    listeners.push(handler);
    return Object.assign(() => { throw new Error('use async release'); }, { ready: Promise.resolve(), release: async () => { releases++; } });
  } } }) } } as unknown as PaseoApi;
  const subscriptions = new TimelineSubscriptions(paseo, {
    event: () => { events++; }, gap: () => { gaps++; }, restored: async () => { restored++; }, error: () => {},
  }, [0]);
  try {
    await subscriptions.watch('a');
    listeners[0]({ agentId: 'a', event: { type: 'error', error: 'restore failed' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(listeners.length, 2);
    assert.equal(releases, 1);
    assert.equal(restored, 1);
    listeners[0]({ agentId: 'a', event: { type: 'replacement', epoch: 'stale' } });
    assert.equal(events, 0);
    listeners[1]({ agentId: 'a', subscriptionId: 'new', event: { type: 'subscription_restored' } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(restored, 2);
    assert.equal(gaps, 2);
    subscriptions.unwatch('a');
  } finally { await subscriptions.dispose(); }
  assert.equal(releases, 2);
});

test('cleanup cancels retries and initial ready rejection cannot remove a newer watch', async () => {
  let reject!: (error: Error) => void;
  let calls = 0;
  const paseo = { agents: { ref: () => ({ timeline: { subscribe: () => {
    calls++;
    return Object.assign(() => {}, { ready: calls === 1 ? new Promise<void>((_, fail) => { reject = fail; }) : Promise.resolve(), release: async () => {} });
  } } }) } } as unknown as PaseoApi;
  const subscriptions = new TimelineSubscriptions(paseo, {
    event: () => {}, gap: () => {}, restored: async () => {}, error: () => {},
  }, [1]);
  const first = subscriptions.watch('a').catch(() => {});
  subscriptions.unwatch('a');
  await subscriptions.watch('a');
  reject(new Error('old failure'));
  await first;
  assert.equal(subscriptions.size, 1);
  await subscriptions.dispose();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 2);
});

test('snapshot traffic cannot bypass exhausted timeline retries; a new lifecycle can explicitly retry', async () => {
  let calls = 0;
  const paseo = { agents: { ref: () => ({ timeline: { subscribe: () => {
    calls++;
    return Object.assign(() => {}, { ready: Promise.reject(new Error('offline')), release: async () => {} });
  } } }) } } as unknown as PaseoApi;
  const subscriptions = new TimelineSubscriptions(paseo, {
    event: () => {}, gap: () => {}, restored: async () => {}, error: () => {},
  }, [0, 0]);
  try {
    await subscriptions.watch('a').catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls, 3);
    for (let n = 0; n < 10; n++) await subscriptions.watch('a');
    assert.equal(calls, 3);
    await subscriptions.watch('a', true).catch(() => {});
    assert.equal(calls, 4);
  } finally { await subscriptions.dispose(); }
});
