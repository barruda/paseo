import { describe, expect, it } from "vitest";
import { answeredData, type BtwTimelineData } from "./btw";

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
