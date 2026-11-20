// CUSTOM(packages): the branch primitives, with git stubbed so the test never touches a repo.
import { expect, it, vi } from "vitest";
import { packageGitOps } from "../server/package-git";
import type { GitExec } from "../server/package-gate";

const git = (exec: GitExec) => packageGitOps(exec);

it("creates a missing branch at the base and leaves an existing one alone", async () => {
  const calls: string[][] = [];
  const exec = vi.fn(async (args: string[]) => {
    calls.push(args);
    if (args.includes("rev-parse")) throw new Error("missing");
    return "";
  });
  expect(await git(exec).ensureBranch("/p", "pkg/auth", "main")).toBe(
    "created",
  );
  expect(
    calls.some(
      (args) =>
        args.includes("branch") &&
        args.includes("pkg/auth") &&
        args.includes("main"),
    ),
  ).toBe(true);
  const existing = vi.fn(async () => "abc");
  expect(await git(existing).ensureBranch("/p", "pkg/auth", "main")).toBe(
    "exists",
  );
});

it("merges the ticket branch into the package branch in a worktree and removes it", async () => {
  const calls: string[][] = [];
  const exec = vi.fn(async (args: string[]) => {
    calls.push(args);
    return "";
  });
  await git(exec).mergeIntoBranch("/p", "/w", "pkg/auth", "task-branch");
  expect(
    calls.some(
      (args) =>
        args.includes("merge") &&
        args.includes("task-branch") &&
        args.includes("/w"),
    ),
  ).toBe(true);
  expect(
    calls.some((args) => args.includes("worktree") && args.includes("remove")),
  ).toBe(true);
});

it("aborts a conflicted merge and throws the git error", async () => {
  const calls: string[][] = [];
  const exec = vi.fn(async (args: string[]) => {
    calls.push(args);
    if (args.includes("merge") && !args.includes("--abort"))
      throw new Error("CONFLICT (content): Merge conflict");
    return "";
  });
  await expect(
    git(exec).mergeIntoBranch("/p", "/w", "pkg/auth", "task"),
  ).rejects.toThrow("CONFLICT");
  expect(
    calls.some((args) => args.includes("merge") && args.includes("--abort")),
  ).toBe(true);
});

it("accepts a valid branch name and rejects one git refuses", async () => {
  const ok = vi.fn(async () => "");
  expect(await git(ok).validBranch("/p", "pkg/auth")).toBe(true);
  const bad = vi.fn(async () => {
    throw new Error("fatal: '-bad' is not a valid branch name");
  });
  expect(await git(bad).validBranch("/p", "-bad")).toBe(false);
});

it("returns null when a ref does not exist", async () => {
  const exec = vi.fn(async () => {
    throw new Error("no such ref");
  });
  expect(await git(exec).refCommit("/p", "pkg/auth")).toBeNull();
});
