// CUSTOM(factory): splits a Markdown file with YAML frontmatter (`---` lines) into the YAML text and
// the body. Parsing the YAML is the caller's job, so this stays free of dependencies.

export type Frontmatter = {
  /** The text between the `---` lines. */
  yaml: string;
  /** 1-based line of the frontmatter's first YAML line. */
  yamlLine: number;
  /** Everything after the closing `---` line. */
  body: string;
};

const FENCE = /^---[ \t]*$/;

/** Null when the text does not open with a `---` line or never closes it. */
export function splitFrontmatter(text: string): Frontmatter | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (!FENCE.test(lines[0] ?? "")) return null;
  const end = lines.findIndex((line, index) => index > 0 && FENCE.test(line));
  if (end < 0) return null;
  return {
    yaml: lines.slice(1, end).join("\n"),
    yamlLine: 2,
    body: lines.slice(end + 1).join("\n"),
  };
}
