import { describe, expect, it } from "vitest";
import { appendChatComment, formatChatComment } from "./model";

describe("formatChatComment", () => {
  it("quotes each excerpt line and puts the comment after a blank line", () => {
    expect(formatChatComment({ excerpt: "first line\n\nsecond line\n", comment: "  why?  " })).toBe(
      "> first line\n>\n> second line\n\nwhy?",
    );
  });
});

describe("appendChatComment", () => {
  it("fills an empty composer", () => {
    expect(appendChatComment("", "> a\n\nb")).toBe("> a\n\nb\n");
  });

  it("adds a blank line after existing text", () => {
    expect(appendChatComment("hello \n\n", "> a\n\nb")).toBe("hello\n\n> a\n\nb\n");
  });
});
