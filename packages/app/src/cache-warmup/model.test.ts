import { describe, expect, it } from "vitest";
import { pickAgentsToWarm, type CacheWarmupCandidate } from "./model";

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

function pick(candidates: CacheWarmupCandidate[], open: string[] = ["a1"]): string[] {
  return pickAgentsToWarm({ candidates, openAgentIds: new Set(open), now: NOW }).map(
    (agent) => agent.agentId,
  );
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
});
