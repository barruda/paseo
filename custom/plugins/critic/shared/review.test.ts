import { CACHE_WARMUP_MESSAGE } from "@getpaseo/protocol/cache-warmup";
import { buildCriticFeedbackMessage, buildCriticNotice } from "@getpaseo/protocol/critic";
import { describe, expect, it } from "vitest";
import {
  buildCriticPrompt,
  citedEvidenceFiles,
  htmlImageSources,
  isReviewableTurn,
  isSameTurn,
  parseVerdict,
  readReviewedTurn,
  sniffImageMime,
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

describe("evidence in the prompt", () => {
  const turn = { request: "paint it", answer: "Painted.", round: 1 };
  const config = { prompt: "", tools: "read" as const, images: [] };

  it("lists what is attached and what the critic has not seen", () => {
    const prompt = buildCriticPrompt({
      config,
      turn,
      diff: null,
      continuing: false,
      evidence: {
        attached: ["/tmp/a.png"],
        unavailable: [{ path: "/tmp/b.png", reason: "file not found" }],
      },
    });
    expect(prompt).toContain("1. /tmp/a.png");
    expect(prompt).toContain("- /tmp/b.png: file not found");
  });

  it("leaves the section out when the answer links to nothing", () => {
    const prompt = buildCriticPrompt({
      config,
      turn,
      diff: null,
      continuing: false,
      evidence: { attached: [], unavailable: [] },
    });
    expect(prompt).not.toContain("<agent_evidence>");
  });

  it("offers unverified, which ends the loop with the note for the user", () => {
    const prompt = buildCriticPrompt({ config, turn, diff: null, continuing: false });
    expect(prompt).toContain("- unverified:");
    const verdict = parseVerdict(
      '<verdict>{"verdict":"unverified","feedback":"no shot"}</verdict>',
    );
    expect(verdict).toEqual({ verdict: "unverified", feedback: "no shot" });
    expect(verdictOutcome({ verdict: verdict!, reply: "", round: 1, maxRounds: 3 })).toEqual({
      status: "unverified",
      feedback: "no shot",
    });
  });
});

describe("citedEvidenceFiles", () => {
  it("finds images and pages in links and code spans, in order, without repeats", () => {
    const answer = [
      "`Temp/first.png`",
      "![a](file:///tmp/my%20shot.png)",
      "[page](/tmp/compare.html) [again](/tmp/compare.html)",
      '[titled](/tmp/titled.webp "title")',
      "[spaced](</tmp/with space.jpg>)",
    ].join(" ");
    expect(citedEvidenceFiles(answer)).toEqual([
      "Temp/first.png",
      "/tmp/my shot.png",
      "/tmp/compare.html",
      "/tmp/titled.webp",
      "/tmp/with space.jpg",
    ]);
  });

  it("ignores web links, other files and code that is not a path", () => {
    const answer = "[a](https://x.dev/a.png) [b](/tmp/notes.md) [c](#a.png) `const a = 'b.png'`";
    expect(citedEvidenceFiles(answer)).toEqual([]);
  });
});

describe("htmlImageSources", () => {
  it("reads local img sources and skips web and data ones", () => {
    const html = `<img src="a.png"><img alt="x" src='/tmp/b.png'><img src="https://x/c.png"><img src="data:image/png;base64,AA">`;
    expect(htmlImageSources(html)).toEqual(["a.png", "/tmp/b.png"]);
  });
});

describe("sniffImageMime", () => {
  it("recognizes images by their first bytes", () => {
    expect(sniffImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(sniffImageMime(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(sniffImageMime(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(sniffImageMime(new TextEncoder().encode("RIFF0000WEBPVP8"))).toBe("image/webp");
    expect(sniffImageMime(new TextEncoder().encode("<svg>"))).toBeNull();
  });
});
