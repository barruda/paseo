import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentStatusSummaryPayload } from "@getpaseo/protocol/messages";
import type { ManagedAgent } from "./agent/agent-manager.js";
import { readWorktreeMerged, WorktreeMergeStatus } from "./worktree-merge-status.js";

let root: string;
let main: string;
let worktree: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function commit(cwd: string, file: string): void {
  writeFileSync(join(cwd, file), file);
  git(cwd, "add", "-A");
  git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", file);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "worktree-merge-status-"));
  main = join(root, "main");
  worktree = join(root, "wt");
  execFileSync("git", ["init", "-q", "-b", "custom", main]);
  commit(main, "a.txt");
  git(main, "worktree", "add", "-q", "-b", "feature", worktree);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readWorktreeMerged", () => {
  it("is null for the main checkout", async () => {
    expect(await readWorktreeMerged(main)).toBeNull();
  });

  it("is false while the worktree has commits the main checkout lacks", async () => {
    commit(worktree, "b.txt");
    expect(await readWorktreeMerged(worktree)).toBe(false);
  });

  it("is true once the main checkout merged the worktree's branch", async () => {
    commit(worktree, "b.txt");
    git(main, "merge", "-q", "--no-edit", "feature");
    commit(main, "c.txt");
    expect(await readWorktreeMerged(worktree)).toBe(true);
  });

  it("is false again when the merged worktree gets new changes", async () => {
    commit(worktree, "b.txt");
    git(main, "merge", "-q", "--no-edit", "feature");
    writeFileSync(join(worktree, "d.txt"), "d");
    expect(await readWorktreeMerged(worktree)).toBe(false);
  });
});

describe("WorktreeMergeStatus", () => {
  it("marks a done summary merged and clears it after new changes", async () => {
    const summary: AgentStatusSummaryPayload = {
      request: "r",
      status: "s",
      done: true,
      updatedAt: "2026-10-26T00:00:00.000Z",
    };
    const summaries = new Map([["a1", summary]]);
    const status = new WorktreeMergeStatus({
      agentManager: {
        listAgents: () => [{ id: "a1", cwd: worktree } as ManagedAgent],
        getStatusSummary: (id) => summaries.get(id) ?? null,
        setStatusSummary: (id, next) => void summaries.set(id, next),
      },
      logger: pino({ level: "silent" }),
    });
    commit(worktree, "b.txt");
    git(main, "merge", "-q", "--no-edit", "feature");
    await status.poll();
    expect(summaries.get("a1")?.merged).toBe(true);

    commit(worktree, "e.txt");
    await status.poll();
    expect(summaries.get("a1")?.merged).toBe(false);
  });
});
