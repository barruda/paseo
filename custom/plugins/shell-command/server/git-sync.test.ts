import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isCreatedFromBranch, parseWorktreeList, readGitSync } from "./git-sync";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).trim();
}

function tryGit(cwd: string, ...args: string[]): void {
  try {
    git(cwd, ...args);
  } catch {
    // A conflicting merge exits non-zero; the test reads the state it leaves.
  }
}

function commit(cwd: string, file: string, text: string, message: string): void {
  writeFileSync(path.join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", message);
}

let root: string;
let main: string;
let wt: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "git-sync-")));
  main = path.join(root, "main");
  wt = path.join(root, "wt");
  execFileSync("git", ["init", "-q", "-b", "trunk", main]);
  git(main, "config", "core.logAllRefUpdates", "true");
  commit(main, "a.txt", "base\n", "base");
  git(main, "worktree", "add", "-q", "-b", "feature", wt, "trunk");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readGitSync", () => {
  it("lists nothing while the worktree has no work", async () => {
    await expect(readGitSync(main)).resolves.toEqual({
      linkedWorktree: false,
      conflicts: null,
      mainConflicts: null,
      incoming: [],
    });
  });

  it("lists a worktree created from the main checkout's branch with commits to bring", async () => {
    commit(wt, "b.txt", "b\n", "b");
    commit(wt, "c.txt", "c\n", "c");
    const status = await readGitSync(main);
    expect(status.incoming).toEqual([{ path: wt, branch: "feature", ahead: 2, dirty: false }]);
  });

  it("lists a worktree with only uncommitted changes", async () => {
    writeFileSync(path.join(wt, "a.txt"), "changed\n");
    const status = await readGitSync(main);
    expect(status.incoming).toEqual([{ path: wt, branch: "feature", ahead: 0, dirty: true }]);
  });

  it("skips worktrees created from another branch", async () => {
    git(main, "branch", "other");
    const other = path.join(root, "other");
    git(main, "worktree", "add", "-q", "-b", "side", other, "other");
    commit(other, "s.txt", "s\n", "s");
    const status = await readGitSync(main);
    expect(status.incoming).toEqual([]);
  });

  it("reports the worktree as linked, with no incoming list", async () => {
    commit(wt, "b.txt", "b\n", "b");
    const status = await readGitSync(wt);
    expect(status).toMatchObject({ linkedWorktree: true, conflicts: null, mainConflicts: null });
    expect(status.incoming).toEqual([]);
  });

  it("reports a conflicting merge in the main checkout, to both sides", async () => {
    commit(wt, "a.txt", "from feature\n", "feature edit");
    commit(main, "a.txt", "from trunk\n", "trunk edit");
    tryGit(main, "merge", "--no-edit", "feature");

    const fromMain = await readGitSync(main);
    expect(fromMain.conflicts).toEqual({
      dir: main,
      operation: "merge",
      currentBranch: "trunk",
      incoming: "feature",
      files: ["a.txt"],
    });

    const fromWorktree = await readGitSync(wt);
    expect(fromWorktree.conflicts).toBeNull();
    expect(fromWorktree.mainConflicts).toMatchObject({ dir: main, files: ["a.txt"] });
  });

  it("does not blame a worktree for a main checkout merge of another branch", async () => {
    git(main, "branch", "other");
    commit(main, "a.txt", "trunk\n", "trunk edit");
    git(main, "checkout", "-q", "other");
    commit(main, "a.txt", "other\n", "other edit");
    git(main, "checkout", "-q", "trunk");
    tryGit(main, "merge", "--no-edit", "other");
    const fromWorktree = await readGitSync(wt);
    expect(fromWorktree.mainConflicts).toBeNull();
  });

  it("reports conflicts inside the worktree itself", async () => {
    commit(main, "a.txt", "from trunk\n", "trunk edit");
    commit(wt, "a.txt", "from feature\n", "feature edit");
    tryGit(wt, "merge", "--no-edit", "trunk");
    const status = await readGitSync(wt);
    expect(status.conflicts).toMatchObject({
      dir: wt,
      operation: "merge",
      currentBranch: "feature",
      incoming: "trunk",
      files: ["a.txt"],
    });
  });

  it("is empty outside a repository", async () => {
    await expect(readGitSync(root)).resolves.toMatchObject({ conflicts: null, incoming: [] });
  });
});

describe("isCreatedFromBranch", () => {
  it("matches the branch and a remote's copy of it", () => {
    expect(isCreatedFromBranch("trunk", "trunk")).toBe(true);
    expect(isCreatedFromBranch("refs/heads/trunk", "trunk")).toBe(true);
    expect(isCreatedFromBranch("origin/trunk", "trunk")).toBe(true);
    expect(isCreatedFromBranch("refs/remotes/origin/trunk", "trunk")).toBe(true);
    expect(isCreatedFromBranch("HEAD", "trunk")).toBe(false);
    expect(isCreatedFromBranch("trunk-2", "trunk")).toBe(false);
  });
});

describe("parseWorktreeList", () => {
  it("reads paths, branches and prunable entries", () => {
    const list = [
      "worktree /repo\nHEAD 1\nbranch refs/heads/main",
      "worktree /wt\nHEAD 2\nbranch refs/heads/feat/x",
      "worktree /gone\nHEAD 3\nbranch refs/heads/old\nprunable gitdir file points nowhere",
      "worktree /detached\nHEAD 4\ndetached",
    ].join("\n\n");
    expect(parseWorktreeList(list)).toEqual([
      { path: "/repo", branch: "main", prunable: false, bare: false },
      { path: "/wt", branch: "feat/x", prunable: false, bare: false },
      { path: "/gone", branch: "old", prunable: true, bare: false },
      { path: "/detached", branch: null, prunable: false, bare: false },
    ]);
  });
});
