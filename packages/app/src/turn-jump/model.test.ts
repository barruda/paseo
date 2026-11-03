import { describe, expect, it } from "vitest";
import { decideTurnJump, findTurnPromptSeq, TURN_JUMP_TTL_MS, type TurnJumpRequest } from "./model";

const prompts = [
  { seq: 3, timestamp: "2026-11-03T18:10:30.000Z" },
  { seq: 40, timestamp: "2026-11-03T18:11:50.000Z" },
  { seq: 52, timestamp: "2026-11-03T18:13:15.000Z" },
];

function request(overrides: Partial<TurnJumpRequest> = {}): TurnJumpRequest {
  return {
    serverId: "s",
    agentId: "a",
    turnStartedAt: "2026-11-03T18:11:53.297Z",
    requestedAt: 1_000,
    ...overrides,
  };
}

describe("findTurnPromptSeq", () => {
  it("picks the last prompt sent before the turn started", () => {
    expect(findTurnPromptSeq(prompts, "2026-11-03T18:11:53.297Z")).toBe(40);
  });

  it("accepts a prompt written just after the turn's start event", () => {
    expect(findTurnPromptSeq(prompts, "2026-11-03T18:13:12.000Z")).toBe(52);
  });

  it("does not take a prompt sent well after the turn started", () => {
    expect(findTurnPromptSeq(prompts, "2026-11-03T18:12:30.000Z")).toBe(40);
  });

  it("finds nothing before the first prompt or for a bad time", () => {
    expect(findTurnPromptSeq(prompts, "2026-11-03T18:00:00.000Z")).toBeNull();
    expect(findTurnPromptSeq(prompts, "not a date")).toBeNull();
  });
});

describe("decideTurnJump", () => {
  it("waits for the prompt index and for the chat to be active", () => {
    expect(decideTurnJump({ request: request(), prompts: [], active: true, now: 1_500 })).toEqual({
      kind: "wait",
    });
    expect(decideTurnJump({ request: request(), prompts, active: false, now: 1_500 })).toEqual({
      kind: "wait",
    });
  });

  it("jumps to the turn's prompt once both are ready", () => {
    expect(decideTurnJump({ request: request(), prompts, active: true, now: 1_500 })).toEqual({
      kind: "jump",
      seq: 40,
    });
  });

  it("drops a stale request and one with no matching prompt", () => {
    expect(
      decideTurnJump({ request: request(), prompts, active: true, now: 1_001 + TURN_JUMP_TTL_MS }),
    ).toEqual({ kind: "drop" });
    expect(
      decideTurnJump({
        request: request({ turnStartedAt: "2026-11-03T17:00:00.000Z" }),
        prompts,
        active: true,
        now: 1_500,
      }),
    ).toEqual({ kind: "drop" });
  });
});
