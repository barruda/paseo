import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MERGE_WORKTREE_COMMAND, resolveWorktreePillLabel } from "./worktree-pill-model";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("MERGE_WORKTREE_COMMAND", () => {
  let root: string;
  let main: string;
  let worktree: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "worktree-pill-"));
    main = path.join(root, "main");
    worktree = path.join(root, "wt");
    execFileSync("git", ["init", "-q", "-b", "main", main]);
    git(main, "config", "user.email", "test@example.com");
    git(main, "config", "user.name", "Test");
    writeFileSync(path.join(main, "README.md"), "hi\n");
    git(main, "add", "README.md");
    git(main, "commit", "-q", "-m", "init");
    git(main, "worktree", "add", "-q", "-b", "feature", worktree);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("commits the worktree as wip and merges its branch into the main checkout", () => {
    writeFileSync(path.join(worktree, "new.txt"), "work\n");
    execFileSync("sh", ["-c", MERGE_WORKTREE_COMMAND], { cwd: worktree });

    expect(git(worktree, "log", "-1", "--format=%s")).toBe("wip");
    expect(git(main, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(main, "ls-files")).toContain("new.txt");
  });

  it("merges committed work when there is nothing left to commit", () => {
    writeFileSync(path.join(worktree, "done.txt"), "done\n");
    git(worktree, "add", "done.txt");
    git(worktree, "commit", "-q", "-m", "done");
    execFileSync("sh", ["-c", MERGE_WORKTREE_COMMAND], { cwd: worktree });

    expect(git(main, "log", "-1", "--format=%s")).toBe("done");
  });
});

describe("resolveWorktreePillLabel", () => {
  it("names the branch, falling back to the workspace name", () => {
    expect(resolveWorktreePillLabel({ currentBranch: "feat/x", workspaceName: "wt" })).toBe(
      "Worktree: feat/x",
    );
    expect(resolveWorktreePillLabel({ currentBranch: null, workspaceName: "wt" })).toBe(
      "Worktree: wt",
    );
  });
});
