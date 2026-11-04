import { describe, expect, it } from "vitest";
import {
  buildCriticFeedbackMessage,
  buildCriticNotice,
  CRITIC_PLUGIN_ID,
  CRITIC_TIMELINE_KIND,
  type CriticReviewStatus,
} from "@getpaseo/protocol/critic";
import type { StreamItem } from "@/types/stream";
import { describeCritic, hideCriticRounds, latestCriticStatus } from "./model";

const at = new Date("2026-11-03T12:00:00Z");

const user = (id: string, text: string): StreamItem => ({
  kind: "user_message",
  id,
  text,
  timestamp: at,
});
const reply = (id: string, text = id): StreamItem => ({
  kind: "assistant_message",
  id,
  text,
  timestamp: at,
});
const tool = (id: string): StreamItem => ({
  kind: "plugin",
  id,
  pluginId: "other",
  pluginItemId: id,
  itemKind: "thing",
  version: 1,
  data: {},
  timestamp: at,
});
const review = (id: string, status: CriticReviewStatus, round = 1): StreamItem => ({
  kind: "plugin",
  id,
  pluginId: CRITIC_PLUGIN_ID,
  pluginItemId: id,
  itemKind: CRITIC_TIMELINE_KIND,
  version: 1,
  data: {
    round,
    maxRounds: 3,
    status,
    answer: "the answer",
    feedback: null,
    error: null,
    criticAgentId: null,
    model: "claude/claude-sonnet-5-5",
    startedAt: at.toISOString(),
    durationMs: null,
  },
  timestamp: at,
});
const feedback = (id: string, round: number) =>
  user(id, buildCriticFeedbackMessage({ round, feedback: "add tests" }));
const ids = (items: StreamItem[]) => items.map((item) => item.id);

describe("hideCriticRounds", () => {
  it("hides a rejected answer and the feedback, keeps tools and the approved answer", () => {
    const tail = [
      user("u1", "build it"),
      tool("t1"),
      reply("a1"),
      review("r1", "rejected"),
      feedback("f1", 1),
      tool("t2"),
      reply("a2"),
      review("r2", "approved", 2),
    ];
    const result = hideCriticRounds(tail, []);
    expect(ids(result.tail)).toEqual(["u1", "t1", "r1", "t2", "a2", "r2"]);
  });

  it("hides the answer while the critic is still reviewing it", () => {
    const result = hideCriticRounds([user("u1", "go"), reply("a1")], [review("r1", "reviewing")]);
    expect(ids(result.tail)).toEqual(["u1"]);
    expect(ids(result.head)).toEqual(["r1"]);
  });

  it("shows the answer when the loop ends without approval", () => {
    for (const status of [
      "limit",
      "question",
      "waiting",
      "unverified",
      "failed",
      "canceled",
    ] as const) {
      const result = hideCriticRounds([user("u1", "go"), reply("a1"), review("r1", status)], []);
      expect(ids(result.tail)).toEqual(["u1", "a1", "r1"]);
    }
  });

  it("strips the critic notice from the user's message", () => {
    const tail = [user("u1", `${buildCriticNotice(true)}build it`), reply("a1")];
    const result = hideCriticRounds(tail, []);
    expect(result.tail[0]).toMatchObject({ kind: "user_message", text: "build it" });
  });

  it("returns the same arrays when there is nothing to hide", () => {
    const tail = [user("u1", "hi"), reply("a1")];
    const head = [reply("a2")];
    const result = hideCriticRounds(tail, head);
    expect(result.tail).toBe(tail);
    expect(result.head).toBe(head);
  });

  it("ignores rows with invalid data", () => {
    const row = review("r1", "rejected");
    const bad: StreamItem = row.kind === "plugin" ? { ...row, data: { status: "rejected" } } : row;
    const result = hideCriticRounds([user("u1", "go"), reply("a1"), bad], []);
    expect(ids(result.tail)).toEqual(["u1", "a1", "r1"]);
  });
});

describe("latestCriticStatus", () => {
  it("reads the last critic row", () => {
    expect(
      latestCriticStatus([review("r1", "rejected"), tool("t"), review("r2", "approved")]),
    ).toBe("approved");
    expect(latestCriticStatus([user("u1", "x")])).toBeNull();
  });
});

describe("describeCritic", () => {
  it("says off, or on with the model and last review", () => {
    expect(describeCritic({ enabled: false, model: "m", status: "approved" })).toEqual([
      "Critic: off",
    ]);
    expect(describeCritic({ enabled: true, model: "claude/x", status: "approved" })).toEqual([
      "Critic: on · claude/x",
      "Last review: approved",
    ]);
  });
});
