import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type SyncReportData, summarizeSync } from "../shared/shell-command";
import { readSyncReport } from "./sync-report";

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: ENV }).trim();
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
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "sync-report-")));
  main = path.join(root, "main");
  wt = path.join(root, "wt");
  execFileSync("git", ["init", "-q", "-b", "trunk", main]);
  commit(main, "a.txt", "base\n", "base");
  git(main, "worktree", "add", "-q", "-b", "feature", wt, "trunk");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function report(data: Omit<SyncReportData, "id" | "checkedAt">): SyncReportData {
  return { id: "r", checkedAt: "2026-11-01T00:00:00.000Z", ...data };
}

describe("readSyncReport", () => {
  it("reports both checkouts in sync", async () => {
    const data = report(await readSyncReport(wt));
    expect(data.error).toBeNull();
    expect(data.worktree).toEqual({ path: wt, branch: "feature", uncommitted: 0, conflicts: [] });
    expect(data.main).toMatchObject({ path: main, branch: "trunk" });
    expect(summarizeSync(data)).toEqual({ headline: "In sync", tone: "success", hint: null });
  });

  it("lists the commits each side lacks and previews a conflicting merge", async () => {
    commit(wt, "a.txt", "feature\n", "feature edit");
    commit(wt, "b.txt", "b\n", "feature add");
    commit(main, "a.txt", "trunk\n", "trunk edit");
    writeFileSync(path.join(wt, "c.txt"), "draft\n");

    const data = report(await readSyncReport(wt));
    expect(data.toMain.total).toBe(2);
    expect(data.toMain.commits.map((c) => c.subject)).toEqual(["feature add", "feature edit"]);
    expect(data.fromMain.total).toBe(1);
    expect(data.fromMain.commits[0]?.subject).toBe("trunk edit");
    expect(data.worktree?.uncommitted).toBe(1);
    expect(data.mergeConflicts).toEqual(["a.txt"]);
    expect(summarizeSync(data)).toMatchObject({
      headline: "2 commits to bring to main · 1 commit to pull from main · 1 uncommitted file",
      tone: "warning",
    });
  });

  it("previews a clean merge", async () => {
    commit(wt, "b.txt", "b\n", "feature add");
    commit(main, "c.txt", "c\n", "trunk add");
    const data = report(await readSyncReport(wt));
    expect(data.mergeConflicts).toEqual([]);
    expect(summarizeSync(data).hint).toContain("pull changes from main project, then merge back");
  });

  it("refuses the main checkout", async () => {
    const data = await readSyncReport(main);
    expect(data.error).toContain("is the main checkout");
  });
});
