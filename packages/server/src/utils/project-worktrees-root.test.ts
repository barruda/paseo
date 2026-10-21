import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  matchProjectSiblingWorktree,
  projectSiblingWorktreeName,
  resolveProjectSiblingWorktrees,
} from "./project-worktrees-root.js";

describe("project sibling worktrees", () => {
  let parent: string;
  let repo: string;

  beforeEach(() => {
    parent = realpathSync(mkdtempSync(path.join(tmpdir(), "paseo-sibling-worktrees-")));
    repo = path.join(parent, "paseo");
    execFileSync("git", ["init", repo], { stdio: "pipe" });
  });

  afterEach(() => rmSync(parent, { recursive: true, force: true }));

  it("names worktrees <parent>/worktrees/<project>-<slug>", () => {
    const sibling = resolveProjectSiblingWorktrees(repo);
    expect(sibling).toEqual({ root: path.join(parent, "worktrees"), prefix: "paseo-" });
    expect(projectSiblingWorktreeName("paseo-", "teste-novo")).toBe("paseo-teste-novo");
    // A slug read back from an existing folder name keeps a single prefix.
    expect(projectSiblingWorktreeName("paseo-", "paseo-teste-novo")).toBe("paseo-teste-novo");
  });

  it("matches a worktree of that project, from inside it too", () => {
    const worktree = path.join(parent, "worktrees", "paseo-teste-novo");
    const expected = { worktreeRoot: path.join(parent, "worktrees"), worktreePath: worktree };
    expect(matchProjectSiblingWorktree(path.join(worktree, "src"), repo)).toEqual(expected);
    // Without the repo root (git forgot the worktree), the project checkout beside it proves it.
    expect(matchProjectSiblingWorktree(worktree)).toEqual(expected);
  });

  it("does not match another project's folder", () => {
    expect(matchProjectSiblingWorktree(path.join(parent, "worktrees", "other-x"))).toBeNull();
    expect(matchProjectSiblingWorktree(path.join(parent, "worktrees", "paseo"))).toBeNull();
    expect(
      matchProjectSiblingWorktree(path.join(parent, "worktrees", "paseo-x"), "/elsewhere/paseo"),
    ).toBeNull();
  });
});
