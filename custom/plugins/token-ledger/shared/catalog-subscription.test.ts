import assert from 'node:assert/strict';
import { test } from 'node:test';
import { subscribeCatalog } from './catalog-subscription.ts';
import { ownedSnapshot } from './subscription-test-helpers.ts';
import type { SessionOutboundMessage } from '@getpaseo/protocol/messages';

type Page = { entries: { id: string; title?: string }[]; pageInfo: { nextCursor: string | null } };
const page = (ids: string[], cursor: string | null = null): Page => ({ entries: ids.map((id) => ({ id })), pageInfo: { nextCursor: cursor } });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('live changes win over pagination; only the newest restored snapshot is committed', async () => {
  const owned = ownedSnapshot(page(['a'], 'next'));
  const pending: Array<(value: Page) => void> = [];
  const snapshots: Page['entries'][] = [];
  const watcher = subscribeCatalog({
    open: async () => owned.page,
    next: () => new Promise<Page>((resolve) => pending.push(resolve)),
    entries: (value) => value.entries, id: (item) => item.id,
    update: (message) => message as unknown as { id: string; item: Page['entries'][0] | null; value: string },
    onSnapshot: (items) => snapshots.push(items), onUpdate: () => {}, onError: (error) => { throw error; },
  });
  try {
    await tick();
    owned.update({ id: 'a', item: { id: 'a', title: 'new' }, value: 'a' } as unknown as SessionOutboundMessage);
    owned.update({ id: 'b', item: null, value: 'b' } as unknown as SessionOutboundMessage);
    pending.shift()!(page(['b', 'c']));
    await watcher.ready;
    assert.deepEqual(snapshots[0], [{ id: 'a', title: 'new' }, { id: 'c' }]);
    owned.snapshot(page(['stale'], 'old-page'));
    owned.snapshot(page(['restored']));
    pending.shift()!(page(['also-stale']));
    await tick();
    assert.deepEqual(snapshots.at(-1), [{ id: 'restored' }]);
    assert.equal(snapshots.length, 2);
  } finally { await watcher.release(); }
});

test('cleanup during establishment releases the late handle and ignores its snapshot', async () => {
  let releases = 0;
  const owned = ownedSnapshot(page(['a']), () => { releases++; });
  let open!: (value: typeof owned.page) => void;
  let snapshots = 0;
  const watcher = subscribeCatalog({
    open: () => new Promise<typeof owned.page>((resolve) => { open = resolve; }),
    next: async () => page([]), entries: (value) => value.entries, id: (item) => item.id,
    update: () => null, onUpdate: () => {}, onSnapshot: () => { snapshots++; }, onError: () => {},
  });
  const closing = watcher.release();
  open(owned.page);
  await closing;
  assert.equal(releases, 1);
  assert.equal(snapshots, 0);
});

test('a post-ready catalog error retries with a new handle and stops at the configured limit', async () => {
  let releases = 0;
  const owned = ownedSnapshot(page(['a']), () => { releases++; });
  let calls = 0;
  const errors: unknown[] = [];
  const watcher = subscribeCatalog({
    open: async () => { if (++calls === 1) return owned.page; throw new Error('offline'); },
    next: async () => page([]), entries: (value) => value.entries, id: (item) => item.id,
    update: () => null, onUpdate: () => {}, onSnapshot: () => {}, onError: (error) => errors.push(error),
    retryDelays: [0, 0],
  });
  try {
    await watcher.ready;
    owned.error(new Error('restore failed'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls, 3);
    assert.equal(errors.length, 3);
    assert.equal(releases, 1);
    watcher.ensure();
    await tick();
    assert.equal(calls, 4, 'an explicit ensure can retry after exhaustion');
  } finally { await watcher.release(); }
});
