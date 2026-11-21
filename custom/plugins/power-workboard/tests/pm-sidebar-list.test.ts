import { describe, expect, it } from "vitest";
import { pmCardSchema, type PmCard } from "../shared/pm-board";
import {
  pmCardImage,
  pmCardSummary,
  pmOpenDecisionCount,
  pmOpenDecisions,
} from "../client/assistant/pm-board/pm-sidebar-list";

const card = (over: Partial<PmCard> & { id: string }): PmCard =>
  pmCardSchema.parse({
    kind: "proposal",
    status: "waiting",
    title: "T",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

describe("pmOpenDecisions", () => {
  it("puts investigations first, newest on top, the oldest waiting last", () => {
    const cards = [
      card({ id: "w-old", updatedAt: "2026-01-01T00:00:00.000Z" }),
      card({ id: "d", status: "decided" }),
      card({
        id: "i-old",
        status: "investigating",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
      card({ id: "w-new", updatedAt: "2026-01-05T00:00:00.000Z" }),
      card({
        id: "i-new",
        status: "investigating",
        updatedAt: "2026-01-04T00:00:00.000Z",
      }),
      card({ id: "a", status: "archived" }),
    ];
    expect(pmOpenDecisions(cards).map((item) => item.id)).toEqual([
      "i-new",
      "i-old",
      "w-new",
      "w-old",
    ]);
    expect(pmOpenDecisionCount(cards)).toBe(2);
  });

  it("is empty for no cards", () => {
    expect(pmOpenDecisions([])).toEqual([]);
    expect(pmOpenDecisionCount([])).toBe(0);
  });
});

describe("pmCardImage", () => {
  it("finds an image in the findings or the question", () => {
    expect(
      pmCardImage(card({ id: "a", findings: "x ![s](https://e.com/a.png) y" })),
    ).toBe("https://e.com/a.png");
    expect(
      pmCardImage(
        card({ id: "b", question: "![s](data:image/png;base64,AAA)" }),
      ),
    ).toBe("data:image/png;base64,AAA");
  });

  it("ignores cards without a usable image", () => {
    expect(pmCardImage(card({ id: "a", findings: "no image" }))).toBeNull();
    expect(
      pmCardImage(card({ id: "b", findings: "![s](file:///etc/x.png)" })),
    ).toBeNull();
    expect(
      pmCardImage(
        card({
          id: "c",
          findings: "![a](javascript:x) ![b](http://e.com/b.png)",
        }),
      ),
    ).toBe("http://e.com/b.png");
  });
});

describe("pmCardSummary", () => {
  it("uses the question of a waiting card", () => {
    expect(
      pmCardSummary(card({ id: "a", question: "Which one?", findings: "f" })),
    ).toBe("Which one?");
  });

  it("strips Markdown from the findings and collapses whitespace", () => {
    expect(
      pmCardSummary(
        card({
          id: "a",
          status: "investigating",
          question: "ignored",
          findings:
            "# Head\n\nSome **bold** and [a link](http://x.y)\n![i](http://x/i.png)\n\n_end_",
        }),
      ),
    ).toBe("Head Some bold and a link end");
  });

  it("may be empty", () => {
    expect(pmCardSummary(card({ id: "a", status: "investigating" }))).toBe("");
  });
});
