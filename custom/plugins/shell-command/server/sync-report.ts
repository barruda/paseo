// CUSTOM(git-sync): the "Check sync status between projects" report for a linked worktree and its
// main checkout. Read-only git (GIT_OPTIONAL_LOCKS=0); the merge preview is `git merge-tree`,
// which touches neither checkout.
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  SYNC_REPORT_COMMIT_LIMIT,
  SYNC_REPORT_TIMELINE_KIND,
  SYNC_REPORT_TIMELINE_VERSION,
  type SyncReportData,
  type syncReportRpc,
} from "../shared/shell-command";
import { git, gitOut, readConflicts } from "./git-sync";

type Side = NonNullable<SyncReportData["worktree"]>;
type Commits = SyncReportData["toMain"];

const NO_COMMITS: Commits = { total: 0, commits: [] };

async function readSide(dir: string, gitDir: string): Promise<Side> {
  const branch = await gitOut(dir, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const status = await gitOut(dir, ["status", "--porcelain"]);
  const conflicts = await readConflicts(dir, gitDir);
  return {
    path: dir,
    branch: branch || null,
    uncommitted: status ? status.split("\n").filter(Boolean).length : 0,
    conflicts: conflicts?.files ?? [],
  };
}

/** Commits in `range` (`A..B`), newest first. */
async function readCommits(cwd: string, range: string): Promise<Commits> {
  const count = Number.parseInt((await gitOut(cwd, ["rev-list", "--count", range])) ?? "0", 10);
  if (!count) return NO_COMMITS;
  const log = await gitOut(cwd, [
    "log",
    `--max-count=${SYNC_REPORT_COMMIT_LIMIT}`,
    "--format=%h%x09%s",
    range,
  ]);
  const commits = (log ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
  return { total: count, commits };
}

/** Files a merge of `ours` and `theirs` would conflict on; empty for a clean merge. */
async function previewMerge(cwd: string, ours: string, theirs: string): Promise<string[] | null> {
  const result = await git(cwd, [
    "merge-tree",
    "--write-tree",
    "--name-only",
    "--no-messages",
    ours,
    theirs,
  ]);
  const lines = result.stdout.split("\n").filter(Boolean);
  // Exit 0: clean (the tree id only). Exit 1: the tree id, then the conflicted files.
  if (result.ok) return [];
  if (lines.length < 2) return null;
  return [...new Set(lines.slice(1))];
}

function failed(error: string): Omit<SyncReportData, "id" | "checkedAt"> {
  return {
    error,
    worktree: null,
    main: null,
    toMain: NO_COMMITS,
    fromMain: NO_COMMITS,
    mergeConflicts: null,
  };
}

export async function readSyncReport(
  cwd: string,
): Promise<Omit<SyncReportData, "id" | "checkedAt">> {
  const dirs = await gitOut(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--git-dir",
    "--git-common-dir",
  ]);
  const [toplevel, gitDir, commonDir] = dirs?.split("\n") ?? [];
  if (!toplevel || !gitDir || !commonDir) return failed(`${cwd} is not in a git repository.`);
  if (path.resolve(gitDir) === path.resolve(commonDir)) {
    return failed(`${toplevel} is the main checkout, not a linked worktree.`);
  }
  if (path.basename(commonDir) !== ".git") {
    return failed("The repository is bare; there is no main checkout to compare with.");
  }
  const mainDir = path.dirname(commonDir);
  const worktree = await readSide(toplevel, gitDir);
  const main = await readSide(mainDir, commonDir);
  const mainHead = await gitOut(mainDir, ["rev-parse", "HEAD"]);
  if (!mainHead) return { ...failed("The main checkout has no commits."), worktree, main };

  const [toMain, fromMain] = await Promise.all([
    readCommits(toplevel, `${mainHead}..HEAD`),
    readCommits(toplevel, `HEAD..${mainHead}`),
  ]);
  const mergeConflicts =
    toMain.total > 0 && fromMain.total > 0 ? await previewMerge(toplevel, "HEAD", mainHead) : [];
  return { error: null, worktree, main, toMain, fromMain, mergeConflicts };
}

export async function postSyncReport(
  input: RpcInput<typeof syncReportRpc>,
  { paseo }: PluginHandlerContext,
): Promise<{ id: string }> {
  const id = `sync-report-${randomUUID()}`;
  const checkedAt = new Date().toISOString();
  const report = await readSyncReport(input.cwd).catch((error: unknown) =>
    failed(error instanceof Error ? error.message : String(error)),
  );
  await paseo.agents.ref(input.agentId).timeline.append({
    type: "plugin",
    id,
    kind: SYNC_REPORT_TIMELINE_KIND,
    version: SYNC_REPORT_TIMELINE_VERSION,
    data: { id, checkedAt, ...report } satisfies SyncReportData,
  });
  return { id };
}
