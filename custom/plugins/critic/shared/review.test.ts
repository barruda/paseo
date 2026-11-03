import { CACHE_WARMUP_MESSAGE } from "@getpaseo/protocol/cache-warmup";
import { buildCriticFeedbackMessage, buildCriticNotice } from "@getpaseo/protocol/critic";
import { describe, expect, it } from "vitest";
import {
  buildCriticPrompt,
  isReviewableTurn,
  isSameTurn,
  parseVerdict,
  readReviewedTurn,
  verdictOutcome,
} from "./review";

const user = (text: string) => ({ type: "user_message" as const, text });
const said = (text: string) => ({ type: "assistant_message" as const, text });

describe("readReviewedTurn", () => {
  it("reads the request, the answer after it and round 1", () => {
    const turn = readReviewedTurn([
      user("old"),
      said("old answer"),
      user(`${buildCriticNotice(true)}add a button`),
      said("Added "),
      said("the button."),
    ]);
    expect(turn).toMatchObject({ request: "add a button", answer: "Added the button.", round: 1 });
  });

  it("after feedback, keeps the user's request and counts the next round", () => {
    const turn = readReviewedTurn([
      user("add a button"),
      said("Added."),
      user(buildCriticFeedbackMessage({ round: 2, feedback: "no tests" })),
      said("Added tests."),
    ]);
    expect(turn).toMatchObject({ request: "add a button", answer: "Added tests.", round: 3 });
  });

  it("skips cache keep-alive pings", () => {
    expect(isReviewableTurn(readReviewedTurn([user(CACHE_WARMUP_MESSAGE), said("pong")]))).toBe(
      false,
    );
    expect(isReviewableTurn(readReviewedTurn([user("work"), said("done")]))).toBe(true);
  });

  it("tells a newer user message apart", () => {
    const before = readReviewedTurn([user("a"), said("x")]);
    expect(isSameTurn(before, readReviewedTurn([user("a"), said("x"), said("y")]))).toBe(true);
    expect(isSameTurn(before, readReviewedTurn([user("a"), said("x"), user("b")]))).toBe(false);
  });
});

describe("buildCriticPrompt", () => {
  const turn = { request: "add a button", answer: "Added it.", round: 1 };

  it("puts the reviewer instructions first and the diff when given", () => {
    const prompt = buildCriticPrompt({
      config: { prompt: "Check the colors.", tools: "off", images: [] },
      turn,
      diff: "+ button",
      continuing: false,
    });
    expect(prompt.indexOf("Check the colors.")).toBeLessThan(prompt.indexOf("add a button"));
    expect(prompt).toContain("<workspace_diff>");
    expect(prompt).toContain("Do not use any tools.");
  });

  it("leaves the diff out when it is off", () => {
    const prompt = buildCriticPrompt({
      config: { prompt: "", tools: "read", images: [] },
      turn,
      diff: null,
      continuing: true,
    });
    expect(prompt).not.toContain("<workspace_diff>");
    expect(prompt).toContain("This is round 1");
    expect(prompt).toContain("You may read files");
  });
});

describe("parseVerdict", () => {
  it("reads the last verdict block", () => {
    expect(
      parseVerdict(
        'Looks off.\n<verdict>{"verdict":"approved"}</verdict>\n<verdict>{"verdict":"rejected","feedback":"Add tests."}</verdict>',
      ),
    ).toEqual({ verdict: "rejected", feedback: "Add tests." });
  });

  it("returns null without a block that parses", () => {
    expect(parseVerdict("I approve.")).toBeNull();
    expect(parseVerdict("<verdict>maybe</verdict>")).toBeNull();
  });
});

describe("verdictOutcome", () => {
  it("rejects with feedback until the last round, then stops at the limit", () => {
    const verdict = { verdict: "rejected" as const, feedback: "Add tests." };
    expect(verdictOutcome({ verdict, reply: "", round: 1, maxRounds: 3 })).toEqual({
      status: "rejected",
      feedback: "Add tests.",
    });
    expect(verdictOutcome({ verdict, reply: "", round: 3, maxRounds: 3 }).status).toBe("limit");
  });

  it("uses the review text when a rejection has no feedback", () => {
    const outcome = verdictOutcome({
      verdict: { verdict: "rejected", feedback: "" },
      reply: 'The button is red.\n<verdict>{"verdict":"rejected"}</verdict>',
      round: 1,
      maxRounds: 2,
    });
    expect(outcome.feedback).toBe("The button is red.");
  });
});
