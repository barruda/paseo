import { describe, expect, it } from "vitest";
import { CLAUDE_MD_EXCLUDES_ENV, parseClaudeMdExcludes } from "./claude-md-excludes";

describe("parseClaudeMdExcludes", () => {
  it("reads a JSON array of strings", () => {
    expect(parseClaudeMdExcludes({ [CLAUDE_MD_EXCLUDES_ENV]: '["/a/CLAUDE.md","/b/**"]' })).toEqual(
      ["/a/CLAUDE.md", "/b/**"],
    );
  });

  it("returns null for a missing, empty, malformed or non-string list", () => {
    expect(parseClaudeMdExcludes(undefined)).toBeNull();
    expect(parseClaudeMdExcludes({})).toBeNull();
    expect(parseClaudeMdExcludes({ [CLAUDE_MD_EXCLUDES_ENV]: "[]" })).toBeNull();
    expect(parseClaudeMdExcludes({ [CLAUDE_MD_EXCLUDES_ENV]: "nope" })).toBeNull();
    expect(parseClaudeMdExcludes({ [CLAUDE_MD_EXCLUDES_ENV]: '{"a":1}' })).toBeNull();
    expect(parseClaudeMdExcludes({ [CLAUDE_MD_EXCLUDES_ENV]: "[1]" })).toBeNull();
  });
});
