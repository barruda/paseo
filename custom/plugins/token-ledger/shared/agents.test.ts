import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPaseoApi, type PaseoApi } from '@getpaseo/client';
import { listAgents, subscribeAgents } from './agents.ts';
import { ownedSnapshot } from './subscription-test-helpers.ts';

test('one-off catalog reads traverse all pages without creating subscriptions', async () => {
  const calls: unknown[] = [];
  const paseo = { agents: { list: async (options: {page: {cursor?: string}}) => {
    calls.push(options);
    return options.page.cursor ? { entries: [{ agent: { id: 'b' } }], pageInfo: { nextCursor: null } }
      : { entries: [{ agent: { id: 'a' } }], pageInfo: { nextCursor: 'next' } };
  } } } as unknown as PaseoApi;
  assert.deepEqual((await listAgents(paseo)).map(a => a.id), ['a', 'b']);
  assert.deepEqual(calls, [
    { page: { limit: 200 } },
    { page: { limit: 200, cursor: 'next' } },
  ]);
});

test('real 0.9 SDK accepts host-assigned catalog IDs, forwards restored pages and releases demand', async () => {
  const first = { entries: [{ agent: { id: 'a' } }], pageInfo: { nextCursor: 'next' } };
  let releases = 0;
  const owned = ownedSnapshot(first, () => { releases++; });
  const calls: unknown[] = [];
  const paseo = createPaseoApi({
    observeAgents: (options: unknown) => { calls.push(options); return owned.page.subscription; },
    fetchAgents: async () => ({ entries: [{ agent: { id: 'b' } }], pageInfo: { nextCursor: null } }),
  } as unknown as Parameters<typeof createPaseoApi>[0]);
  const snapshots: string[][] = [];
  const subscription = subscribeAgents(paseo, {
    onSnapshot: (agents) => snapshots.push(agents.map((agent) => agent.id)),
    onUpdate: () => {}, onError: (error) => { throw error; },
  });
  try {
    await subscription.ready;
    assert.deepEqual(calls, [{ subscribe: {}, page: { limit: 200 } }]);
    assert.deepEqual(snapshots, [['a', 'b']]);
    owned.snapshot({ entries: [{ agent: { id: 'new' } }], pageInfo: { nextCursor: 'next' } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(snapshots.at(-1), ['new', 'b']);
  } finally { await subscription.release(); await paseo.dispose(); }
  assert.equal(releases, 1);
});
test('repeated pagination cursor fails instead of looping forever', async () => {
  const paseo = { agents: { list: async () => ({ entries: [], pageInfo: { nextCursor: 'same' } }) } } as unknown as PaseoApi;
  await assert.rejects(listAgents(paseo), /Repeated/);
});
