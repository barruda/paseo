import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isLinkedWorktreeWorkspace,
  MERGE_WORKTREE_COMMAND,
  resolveWorktreePillLabel,
} from "./worktree-pill-model";

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

// CUSTOM(worktree-pill-own-project): a worktree opened as its own project still gets the pill.
describe("isLinkedWorktreeWorkspace", () => {
  it("detects a worktree registered as its own project", () => {
    expect(
      isLinkedWorktreeWorkspace({
        workspaceKind: "worktree",
        directory: "/home/u/DreamMMO-wt1",
        projectRootPath: "/home/u/DreamMMO-wt1",
        checkout: { mainRepoRoot: "/home/u/DreamMMO", worktreeRoot: "/mnt/disk/DreamMMO-wt1" },
      }),
    ).toBe(true);
  });

  it("detects a worktree inside the main repo's project", () => {
    expect(
      isLinkedWorktreeWorkspace({
        workspaceKind: "worktree",
        directory: "/home/u/worktrees/repo-swan",
        projectRootPath: "/home/u/repo",
        checkout: { mainRepoRoot: "/home/u/repo", worktreeRoot: "/home/u/worktrees/repo-swan" },
      }),
    ).toBe(true);
  });

  it("leaves out the main checkout reporting kind worktree", () => {
    expect(
      isLinkedWorktreeWorkspace({
        workspaceKind: "worktree",
        directory: "/home/u/repo",
        projectRootPath: "/home/u/repo",
        checkout: { mainRepoRoot: "/home/u/repo/", worktreeRoot: "/home/u/repo" },
      }),
    ).toBe(false);
  });

  it("leaves out a main checkout opened by a symlink", () => {
    expect(
      isLinkedWorktreeWorkspace({
        workspaceKind: "worktree",
        directory: "/home/u/link-to-repo",
        projectRootPath: "/home/u/link-to-repo",
        checkout: { mainRepoRoot: "/mnt/disk/repo", worktreeRoot: "/mnt/disk/repo" },
      }),
    ).toBe(false);
  });

  it("falls back to the project root without a checkout", () => {
    const base = { workspaceKind: "worktree", projectRootPath: "/home/u/repo" };
    expect(isLinkedWorktreeWorkspace({ ...base, directory: "/home/u/repo" })).toBe(false);
    expect(isLinkedWorktreeWorkspace({ ...base, directory: "/home/u/wt" })).toBe(true);
  });

  it("is false for other workspace kinds", () => {
    expect(
      isLinkedWorktreeWorkspace({
        workspaceKind: "local_checkout",
        directory: "/home/u/wt",
        projectRootPath: "/home/u/repo",
        checkout: { mainRepoRoot: "/home/u/repo", worktreeRoot: "/home/u/wt" },
      }),
    ).toBe(false);
  });
});
