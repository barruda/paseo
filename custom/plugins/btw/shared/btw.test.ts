import { describe, expect, it } from "vitest";
import {
  answeredData,
  type BtwFollowUp,
  type BtwTimelineData,
  formatThread,
  isAsking,
  threadHistory,
} from "./btw";

const asked: BtwTimelineData = {
  question: "what changed?",
  status: "asking",
  answer: null,
  error: null,
  askedAt: "2026-10-23T12:00:00.000Z",
  durationMs: null,
};

describe("answeredData", () => {
  it("records the answer and how long it took", () => {
    expect(answeredData(asked, { answer: "Two files.", error: null }, 1500)).toEqual({
      ...asked,
      status: "answered",
      answer: "Two files.",
      durationMs: 1500,
    });
  });

  it("records a failure", () => {
    expect(answeredData(asked, { answer: null, error: "Agent is archived" }, 10)).toMatchObject({
      status: "failed",
      answer: null,
      error: "Agent is archived",
    });
  });

  it("says so when Claude declines", () => {
    expect(answeredData(asked, { answer: null, error: null }, 10).answer).toContain("declined");
  });

  it("cuts an answer that would not fit the timeline row", () => {
    const answer = answeredData(asked, { answer: "x".repeat(60_000), error: null }, 10).answer;
    expect(answer?.length).toBeLessThan(50 * 1024);
    expect(answer?.endsWith("[…]")).toBe(true);
  });
});

const followUp = (overrides: Partial<BtwFollowUp>): BtwFollowUp => ({
  kind: "question",
  question: "and why?",
  fileNames: [],
  status: "answered",
  answer: "Because.",
  error: null,
  askedAt: "2026-10-23T12:01:00.000Z",
  durationMs: 900,
  ...overrides,
});

describe("thread", () => {
  const card: BtwTimelineData = {
    ...asked,
    status: "answered",
    answer: "Two files.",
    followUps: [
      followUp({ fileNames: ["notes.txt"] }),
      followUp({ question: "TLDR", kind: "tldr", status: "failed", answer: null, error: "x" }),
    ],
  };

  it("passes only the answered turns as history, oldest first", () => {
    expect(threadHistory(card)).toEqual([
      { question: "what changed?", answer: "Two files." },
      { question: "and why?", answer: "Because." },
    ]);
  });

  it("is asking while any turn waits for its answer", () => {
    expect(isAsking(card)).toBe(false);
    expect(isAsking({ ...card, followUps: [followUp({ status: "asking", answer: null })] })).toBe(
      true,
    );
  });

  it("writes every question and answer for a branch, follow-ups and files included", () => {
    const text = formatThread(card);
    expect(text).toContain("Q: what changed?\nA: Two files.");
    expect(text).toContain("Q: and why? (attached: notes.txt)\nA: Because.");
    expect(text).toContain("Q: TLDR\nA: x");
  });
});
