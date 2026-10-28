import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  CACHE_WARMUP_MESSAGE,
  cacheWarmupAgentKey,
  describeCacheWarmup,
  hideCacheWarmupTurns,
  pickAgentsToWarm,
  type CacheWarmupCandidate,
} from "./model";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const MINUTE = 60_000;

function candidate(overrides: Partial<CacheWarmupCandidate> = {}): CacheWarmupCandidate {
  return {
    serverId: "srv",
    agentId: "a1",
    provider: "claude",
    status: "idle",
    contextTokens: 150_000,
    lastActivityAt: NOW - 58 * MINUTE,
    ...overrides,
  };
}

function pick(
  candidates: CacheWarmupCandidate[],
  open: string[] = ["a1"],
  disabled: string[] = [],
): string[] {
  return pickAgentsToWarm({
    candidates,
    openAgentIds: new Set(open),
    disabledAgentKeys: new Set(disabled),
    now: NOW,
  }).map((agent) => agent.agentId);
}

describe("pickAgentsToWarm", () => {
  it("pings an idle open Claude session over 100k tokens 57 minutes after its last activity", () => {
    expect(pick([candidate()])).toEqual(["a1"]);
    expect(pick([candidate({ lastActivityAt: NOW - 57 * MINUTE })])).toEqual(["a1"]);
  });

  it("waits until 57 minutes and gives up once the hour has passed", () => {
    expect(pick([candidate({ lastActivityAt: NOW - 56 * MINUTE })])).toEqual([]);
    expect(pick([candidate({ lastActivityAt: NOW - 60 * MINUTE })])).toEqual([]);
  });

  it("skips sessions at or under 100k tokens or without usage", () => {
    expect(pick([candidate({ contextTokens: 100_000 })])).toEqual([]);
    expect(pick([candidate({ contextTokens: null })])).toEqual([]);
  });

  it("skips sessions without an open tab, busy sessions and other providers", () => {
    expect(pick([candidate()], [])).toEqual([]);
    expect(pick([candidate({ status: "running" })])).toEqual([]);
    expect(pick([candidate({ provider: "codex" })])).toEqual([]);
  });

  it("skips sessions whose toggle is off", () => {
    expect(pick([candidate()], ["a1"], [cacheWarmupAgentKey("srv", "a1")])).toEqual([]);
    expect(pick([candidate()], ["a1"], [cacheWarmupAgentKey("other", "a1")])).toEqual(["a1"]);
  });
});

describe("describeCacheWarmup", () => {
  const base = { enabled: true, status: "idle", contextTokens: 150_000, now: NOW };

  it("counts the minutes until the cache goes cold", () => {
    expect(describeCacheWarmup({ ...base, lastActivityAt: NOW - 18 * MINUTE })).toEqual([
      "Keep cache warm: on",
      "Cold in 42 min",
    ]);
    expect(describeCacheWarmup({ ...base, lastActivityAt: NOW - 61 * MINUTE })[1]).toBe(
      "Cache is cold",
    );
  });

  it("says the cache is in use while running and notes the token floor", () => {
    expect(
      describeCacheWarmup({ ...base, status: "running", contextTokens: 50_000, lastActivityAt: 0 }),
    ).toEqual(["Keep cache warm: on", "Cache in use", "Pings start above 100k tokens"]);
    expect(
      describeCacheWarmup({ ...base, enabled: false, contextTokens: 50_000, lastActivityAt: NOW }),
    ).toEqual(["Keep cache warm: off", "Cold in 60 min"]);
  });
});

describe("hideCacheWarmupTurns", () => {
  const at = new Date(NOW);
  const user = (id: string, text: string): StreamItem => ({
    kind: "user_message",
    id,
    text,
    timestamp: at,
  });
  const reply = (id: string, text: string): StreamItem => ({
    kind: "assistant_message",
    id,
    text,
    timestamp: at,
  });
  const ids = (items: StreamItem[]) => items.map((item) => item.id);

  it("hides each ping and everything up to the next user message", () => {
    const tail = [
      user("u1", "fix the bug"),
      reply("r1", "done"),
      user("p1", CACHE_WARMUP_MESSAGE),
      reply("r2", "pong"),
      user("p2", CACHE_WARMUP_MESSAGE),
      reply("r3", "pong"),
      user("u2", "thanks"),
      reply("r4", "welcome"),
    ];
    expect(ids(hideCacheWarmupTurns(tail, []).tail)).toEqual(["u1", "r1", "u2", "r4"]);
  });

  it("hides a reply streaming in the head after a ping in the tail", () => {
    const tail = [user("u1", "hi"), reply("r1", "hello"), user("p1", CACHE_WARMUP_MESSAGE)];
    const result = hideCacheWarmupTurns(tail, [reply("r2", "po")]);
    expect(ids(result.tail)).toEqual(["u1", "r1"]);
    expect(result.head).toEqual([]);
  });

  it("returns the same arrays when there is no ping", () => {
    const tail = [user("u1", "hi"), reply("r1", "hello")];
    const head = [reply("r2", "more")];
    const result = hideCacheWarmupTurns(tail, head);
    expect(result.tail).toBe(tail);
    expect(result.head).toBe(head);
  });
});
