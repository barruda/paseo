import { describe, expect, it } from "vitest";

import {
  historyQueryHighlightText,
  parseHistoryQuery,
  textContainsHistoryTerm,
} from "./history-query";

// CUSTOM(history-content-search)

function shape(query: string) {
  const parsed = parseHistoryQuery(query);
  const render = (term: { words: string[]; exact: boolean }) =>
    term.exact ? `"${term.words.join(" ")}"` : term.words.join(" ");
  return {
    required: parsed.required.map((group) => group.map(render)),
    excluded: parsed.excluded.map(render),
  };
}

describe("parseHistoryQuery", () => {
  it("reads quoted phrases, OR groups, and exclusions", () => {
    expect(shape('relay "at once" socket OR tunnel -staging -"dry run"')).toEqual({
      required: [["relay"], ['"at once"'], ["socket", "tunnel"]],
      excluded: ["staging", '"dry run"'],
    });
  });

  it("treats lowercase or, a lone dash, and dangling OR as plain text", () => {
    expect(shape("relay or tunnel")).toEqual({
      required: [["relay"], ["or"], ["tunnel"]],
      excluded: [],
    });
    expect(shape("OR relay - OR")).toEqual({ required: [["relay"]], excluded: [] });
    expect(shape("a | b")).toEqual({ required: [["a", "b"]], excluded: [] });
  });

  it("never joins an exclusion into an OR group", () => {
    expect(shape("a OR -b OR c")).toEqual({ required: [["a"], ["c"]], excluded: ["b"] });
  });

  it("keeps an unclosed phrase's last word a prefix", () => {
    const [[term]] = parseHistoryQuery('"at on').required;
    expect(term).toEqual({ text: "at on", words: ["at", "on"], exact: false });
  });

  it("splits words like the message index, ignoring case and accents", () => {
    expect(shape("Reconexão web-socket")).toEqual({
      required: [["reconexao"], ["web socket"]],
      excluded: [],
    });
  });
});

describe("textContainsHistoryTerm", () => {
  const term = (query: string) => parseHistoryQuery(query).required[0][0];

  it("matches adjacent whole words, with a prefix only on an unquoted last word", () => {
    expect(textContainsHistoryTerm("Run all at once", term('"at once"'))).toBe(true);
    expect(textContainsHistoryTerm("Look at it once", term('"at once"'))).toBe(false);
    expect(textContainsHistoryTerm("at onceover", term('"at once"'))).toBe(false);
    expect(textContainsHistoryTerm("at onceover", term("at-once"))).toBe(true);
  });
});

describe("historyQueryHighlightText", () => {
  it("keeps what the query asks for and drops operators and exclusions", () => {
    expect(historyQueryHighlightText('"at once" relay OR tunnel -staging')).toBe(
      "at once relay tunnel",
    );
  });
});
