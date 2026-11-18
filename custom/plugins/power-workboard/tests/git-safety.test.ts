import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkGitSafety } from "../server/git-safety";

it("protects real dirty/untracked/unpushed Git work and requires an upstream", async () => {
  const root = await mkdtemp(join(tmpdir(), "workboard-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    git("init", "-b", "main");
    git("config", "user.name", "Workboard fixture");
    git("config", "user.email", "fixture@example.invalid");
    await writeFile(join(root, "a"), "initial\n");
    git("add", "a");
    git("commit", "-m", "initial");
    expect(await checkGitSafety(root, true)).toBe("git-no-upstream");
    const remote = await mkdtemp(join(tmpdir(), "workboard-remote-"));
    try {
      execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
      git("remote", "add", "origin", remote);
      git("push", "-u", "origin", "main");
      expect(await checkGitSafety(root, true)).toBeNull();
      await writeFile(join(root, "new"), "keep me\n");
      expect(await checkGitSafety(root, true)).toBe("git-dirty");
      git("add", "new");
      git("commit", "-m", "unpushed");
      expect(await checkGitSafety(root, true)).toBe("git-unpushed");
      git("push");
      git("checkout", "--detach");
      expect(await checkGitSafety(root, true)).toBe("git-detached");
    } finally {
      await rm(remote, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("allows an existing non-Git directory but not a missing directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workboard-nongit-"));
  try {
    expect(await checkGitSafety(dir, false)).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  expect(await checkGitSafety(dir, false)).toBe("directory-unavailable");
});

async function mergedRepo() {
  const root = await mkdtemp(join(tmpdir(), "workboard-merged-"));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git(root, "init", "-b", "custom");
  git(root, "config", "user.name", "Workboard fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  await writeFile(join(root, "a"), "initial\n");
  git(root, "add", "a");
  git(root, "commit", "-m", "initial");
  return { root, git };
}

it("treats a branch already merged into the policy base as safe without an upstream", async () => {
  const { root, git } = await mergedRepo();
  try {
    git(root, "checkout", "-b", "task");
    expect(await checkGitSafety(root, true, "custom")).toBeNull();
    await writeFile(join(root, "b"), "work\n");
    git(root, "add", "b");
    git(root, "commit", "-m", "unmerged work");
    expect(await checkGitSafety(root, true, "custom")).toBe("git-unmerged");
    git(root, "checkout", "custom");
    git(root, "merge", "--no-ff", "-m", "merge", "task");
    git(root, "checkout", "task");
    expect(await checkGitSafety(root, true, "custom")).toBeNull();
    await writeFile(join(root, "untracked"), "keep\n");
    expect(await checkGitSafety(root, true, "custom")).toBe("git-dirty");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("falls back to no upstream when no base resolves", async () => {
  const { root, git } = await mergedRepo();
  try {
    git(root, "checkout", "-b", "task");
    expect(await checkGitSafety(root, true)).toBe("git-no-upstream");
    expect(await checkGitSafety(root, true, "missing")).toBe("git-no-upstream");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("reads the base from the worktree metadata under its git dir", async () => {
  const { root, git } = await mergedRepo();
  const tree = `${root}-wt`;
  try {
    git(root, "worktree", "add", "-b", "task", tree);
    const gitDir = git(tree, "rev-parse", "--absolute-git-dir").trim();
    await mkdir(join(gitDir, "paseo"), { recursive: true });
    await writeFile(
      join(gitDir, "paseo", "worktree.json"),
      JSON.stringify({ baseRef: "refs/heads/custom" }),
    );
    expect(await checkGitSafety(tree, true)).toBeNull();
    await writeFile(join(tree, "c"), "work\n");
    git(tree, "add", "c");
    git(tree, "commit", "-m", "unmerged work");
    expect(await checkGitSafety(tree, true)).toBe("git-unmerged");
  } finally {
    await rm(tree, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
