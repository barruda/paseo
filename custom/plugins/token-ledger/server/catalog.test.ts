import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPaseoApi } from '@getpaseo/client';
import { ownedSnapshot } from '../shared/subscription-test-helpers.ts';
import { Catalog } from './catalog.ts';

test('workspace catalog uses real 0.9 owned subscriptions and replaces stale names on restore', async () => {
  const initial = { entries: [{ id: 'w1', title: 'First', name: 'one' }], pageInfo: { nextCursor: 'next' as string | null } };
  let released = 0;
  const owned = ownedSnapshot(initial, () => { released++; });
  const paseo = createPaseoApi({
    observeWorkspaces: () => owned.page.subscription,
    fetchWorkspaces: async () => ({ entries: [{ id: 'w2', title: null, name: 'two' }], pageInfo: { nextCursor: null } }),
  } as unknown as Parameters<typeof createPaseoApi>[0]);
  const catalog = new Catalog();
  try {
    await catalog.ensureWorkspaces(paseo);
    assert.deepEqual([...catalog.workspaceNames], [['w1', 'First'], ['w2', 'two']]);
    owned.snapshot({ entries: [{ id: 'w3', title: 'Restored', name: 'three' }], pageInfo: { nextCursor: null } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual([...catalog.workspaceNames], [['w3', 'Restored']]);
  } finally { await catalog.dispose(); await paseo.dispose(); }
  assert.equal(released, 1);
});
