import { describe, expect, it } from "vitest";
import { demoteMarkdownHeadingsToH3 } from "./demote-markdown-headings";

describe("demoteMarkdownHeadingsToH3", () => {
  it("turns ATX H1 and H2 into H3 and keeps H3 and H4", () => {
    const input = ["# Title", "", "## Section", "", "### Sub", "", "#### Detail"].join("\n");

    expect(demoteMarkdownHeadingsToH3(input)).toBe(
      ["### Title", "", "### Section", "", "### Sub", "", "#### Detail"].join("\n"),
    );
  });

  it("converts setext H1 and H2 headings to ATX H3", () => {
    const input = ["Title", "=====", "", "Section", "-------"].join("\n");

    expect(demoteMarkdownHeadingsToH3(input)).toBe(["### Title", "", "### Section"].join("\n"));
  });

  it("leaves lines inside fenced code alone", () => {
    const input = ["```md", "# not a heading", "## neither", "```", "", "# Real"].join("\n");

    expect(demoteMarkdownHeadingsToH3(input)).toBe(
      ["```md", "# not a heading", "## neither", "```", "", "### Real"].join("\n"),
    );
  });

  it("demotes headings inside blockquotes and list items", () => {
    const input = ["> ## Quoted", "", "- # Listed"].join("\n");

    expect(demoteMarkdownHeadingsToH3(input)).toBe(["> ### Quoted", "", "- ### Listed"].join("\n"));
  });

  it("returns text without headings unchanged", () => {
    const input = "Plain **text** with a # hash in the middle.\n\n- item";

    expect(demoteMarkdownHeadingsToH3(input)).toBe(input);
  });
});
