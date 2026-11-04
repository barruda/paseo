import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { searchWorkspaceContent } from "./workspace-content-search.js";

let root: string;

async function write(relativePath: string, content: string | Buffer) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

function git(...args: string[]) {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "content-search-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("searchWorkspaceContent in a repo", () => {
  beforeEach(() => {
    git("init", "-q");
  });

  it("finds tracked and untracked files, with their line, and skips ignored ones", async () => {
    await write(".gitignore", "ignored.txt\n");
    await write("tracked.txt", "first\n  needle here  \n");
    await write("src/untracked file ç.txt", "a needle\n");
    await write("ignored.txt", "needle\n");
    git("add", ".gitignore", "tracked.txt");

    const result = await searchWorkspaceContent({ cwd: root, query: "needle" });

    expect(result).toEqual({
      matches: [
        { path: "src/untracked file ç.txt", line: 1, text: "a needle" },
        { path: "tracked.txt", line: 2, text: "needle here" },
      ],
      truncated: false,
    });
  });

  it("ignores case unless the query has a capital", async () => {
    await write("a.txt", "Needle\nneedle\n");

    const lower = await searchWorkspaceContent({ cwd: root, query: "needle" });
    const upper = await searchWorkspaceContent({ cwd: root, query: "Needle" });

    expect(lower.matches.map((match) => match.line)).toEqual([1, 2]);
    expect(upper.matches.map((match) => match.line)).toEqual([1]);
  });

  it("treats the query as literal text, even when it looks like a flag or a regex", async () => {
    await write("a.txt", "--version\nfoo(bar\nfooXbar\n");

    const flag = await searchWorkspaceContent({ cwd: root, query: "--version" });
    const regex = await searchWorkspaceContent({ cwd: root, query: "foo(b" });

    expect(flag.matches.map((match) => match.line)).toEqual([1]);
    expect(regex.matches.map((match) => match.line)).toEqual([2]);
  });

  it("returns paths relative to a subfolder workspace", async () => {
    await write("sub/a.txt", "needle\n");
    await write("other.txt", "needle\n");

    const result = await searchWorkspaceContent({ cwd: path.join(root, "sub"), query: "needle" });

    expect(result.matches.map((match) => match.path)).toEqual(["a.txt"]);
  });

  it("skips binary files and finds nothing without an error", async () => {
    await write("binary.bin", Buffer.from([0, 110, 101, 101, 100, 108, 101, 0]));

    expect(await searchWorkspaceContent({ cwd: root, query: "needle" })).toEqual({
      matches: [],
      truncated: false,
    });
  });

  it("stops at the limit and says so", async () => {
    await write("a.txt", "needle\nneedle\nneedle\n");

    const result = await searchWorkspaceContent({ cwd: root, query: "needle", limit: 2 });

    expect(result.matches).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("does not run git for a blank query", async () => {
    expect(await searchWorkspaceContent({ cwd: "/does/not/exist", query: "  " })).toEqual({
      matches: [],
      truncated: false,
    });
  });
});

describe("searchWorkspaceContent outside a repo", () => {
  it("searches the plain folder", async () => {
    await write("notes/a.txt", "a needle\n");

    const result = await searchWorkspaceContent({ cwd: root, query: "needle" });

    expect(result.matches).toEqual([{ path: "notes/a.txt", line: 1, text: "a needle" }]);
  });
});
