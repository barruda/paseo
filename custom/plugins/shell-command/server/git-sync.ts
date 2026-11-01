// CUSTOM(git-sync): reads what the composer's git chips show. Every git call is read-only and runs
// with GIT_OPTIONAL_LOCKS=0, so polling never takes the index lock an agent's own git needs.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GitConflicts, GitSyncStatus, IncomingWorktree } from "../shared/shell-command";

const GIT_TIMEOUT_MS = 5_000;

const EMPTY: GitSyncStatus = {
  linkedWorktree: false,
  conflicts: null,
  mainConflicts: null,
  incoming: [],
};

export function git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
      (error, stdout) => resolve({ ok: !error, stdout: String(stdout) }),
    );
  });
}

export async function gitOut(cwd: string, args: string[]): Promise<string | null> {
  const result = await git(cwd, args);
  return result.ok ? result.stdout.trim() : null;
}

async function readText(file: string): Promise<string | null> {
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    return null;
  }
}

function stripHeads(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

/** A readable name for a commit: the branch it is on (`name-rev`), else its short hash. */
async function describeCommit(cwd: string, sha: string | null): Promise<string | null> {
  if (!sha) return null;
  const name = await gitOut(cwd, ["name-rev", "--name-only", "--no-undefined", sha]);
  if (name) return name.replace(/^remotes\//, "");
  return sha.slice(0, 10);
}

/** Unresolved conflicts in the checkout at `dir`, whose git dir is `gitDir`. */
export async function readConflicts(dir: string, gitDir: string): Promise<GitConflicts | null> {
  const unmerged = await git(dir, ["diff", "--name-only", "--diff-filter=U", "-z"]);
  if (!unmerged.ok) return null;
  const files = [...new Set(unmerged.stdout.split("\0").filter(Boolean))];
  if (files.length === 0) return null;

  const branch = await gitOut(dir, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const firstLine = (text: string | null) => text?.split("\n")[0]?.trim() || null;
  const at = (name: string) => path.join(gitDir, name);

  if (existsSync(at("rebase-merge")) || existsSync(at("rebase-apply"))) {
    const stateDir = existsSync(at("rebase-merge")) ? at("rebase-merge") : at("rebase-apply");
    const headName = await readText(path.join(stateDir, "head-name"));
    const onto = await readText(path.join(stateDir, "onto"));
    return {
      dir,
      operation: "rebase",
      currentBranch: headName ? stripHeads(headName) : branch,
      incoming: await describeCommit(dir, onto),
      files,
    };
  }
  const operations = [
    ["MERGE_HEAD", "merge"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
  ] as const;
  for (const [head, operation] of operations) {
    const sha = firstLine(await readText(at(head)));
    if (!sha) continue;
    return {
      dir,
      operation,
      currentBranch: branch,
      incoming: await describeCommit(dir, sha),
      files,
    };
  }
  return { dir, operation: null, currentBranch: branch, incoming: null, files };
}

/** The `<start>` of the branch's oldest reflog entry, "branch: Created from <start>". */
async function readCreatedFrom(commonDir: string, branch: string): Promise<string | null> {
  const log = await readText(path.join(commonDir, "logs", "refs", "heads", ...branch.split("/")));
  const first = log?.split("\n")[0] ?? "";
  const match = /\tbranch: Created from (.+)$/.exec(first);
  return match?.[1]?.trim() ?? null;
}

/**
 * True when a branch created from `createdFrom` was branched off `parent`: the same branch, or a
 * remote's copy of it (`origin/<parent>`). `HEAD` tells nothing about which branch it was.
 */
export function isCreatedFromBranch(createdFrom: string, parent: string): boolean {
  const name = stripHeads(createdFrom).replace(/^heads\//, "");
  if (name === parent) return true;
  const remote = name.replace(/^refs\/remotes\//, "").replace(/^remotes\//, "");
  const slash = remote.indexOf("/");
  return slash > 0 && remote.slice(slash + 1) === parent;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  prunable: boolean;
  bare: boolean;
}

export function parseWorktreeList(porcelain: string): WorktreeEntry[] {
  return porcelain
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n").filter(Boolean);
      const worktree = lines.find((line) => line.startsWith("worktree "));
      if (!worktree) return null;
      const branch = lines.find((line) => line.startsWith("branch "));
      return {
        path: worktree.slice("worktree ".length),
        branch: branch ? stripHeads(branch.slice("branch ".length)) : null,
        prunable: lines.some((line) => line.startsWith("prunable")),
        bare: lines.includes("bare"),
      };
    })
    .filter((entry): entry is WorktreeEntry => entry !== null);
}

async function readIncoming(input: {
  toplevel: string;
  commonDir: string;
  branch: string;
}): Promise<IncomingWorktree[]> {
  const list = await gitOut(input.toplevel, ["worktree", "list", "--porcelain"]);
  if (!list) return [];
  const incoming: IncomingWorktree[] = [];
  for (const entry of parseWorktreeList(list)) {
    if (entry.bare || entry.prunable || !entry.branch) continue;
    if (path.resolve(entry.path) === path.resolve(input.toplevel)) continue;
    if (entry.branch === input.branch || !existsSync(entry.path)) continue;
    const createdFrom = await readCreatedFrom(input.commonDir, entry.branch);
    if (!createdFrom || !isCreatedFromBranch(createdFrom, input.branch)) continue;
    const count = await gitOut(input.toplevel, [
      "rev-list",
      "--count",
      `HEAD..refs/heads/${entry.branch}`,
    ]);
    const ahead = Number.parseInt(count ?? "0", 10) || 0;
    const status = await gitOut(entry.path, ["status", "--porcelain"]);
    const dirty = Boolean(status);
    if (ahead > 0 || dirty) incoming.push({ path: entry.path, branch: entry.branch, ahead, dirty });
  }
  return incoming;
}

/**
 * Conflicts in `cwd`; for a linked worktree, also the main checkout's conflicts from merging this
 * worktree's branch; for a main checkout on a branch, the worktrees created from that branch that
 * have commits it lacks or uncommitted changes.
 */
export async function readGitSync(cwd: string): Promise<GitSyncStatus> {
  if (!existsSync(cwd)) return EMPTY;
  const dirs = await gitOut(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--git-dir",
    "--git-common-dir",
  ]);
  const [toplevel, gitDir, commonDir] = dirs?.split("\n") ?? [];
  if (!toplevel || !gitDir || !commonDir) return EMPTY;

  const linkedWorktree = path.resolve(gitDir) !== path.resolve(commonDir);
  const conflicts = await readConflicts(toplevel, gitDir);

  if (linkedWorktree) {
    // The main checkout is the parent of the shared git dir (not for a bare repo).
    const mainDir = path.basename(commonDir) === ".git" ? path.dirname(commonDir) : null;
    let mainConflicts = mainDir ? await readConflicts(mainDir, commonDir) : null;
    if (mainConflicts) {
      // Only a merge of this worktree's branch, at a commit it still contains.
      const mergeHead = (await readText(path.join(commonDir, "MERGE_HEAD")))?.split("\n")[0];
      const related =
        mainConflicts.operation === "merge" &&
        mergeHead !== undefined &&
        (await git(toplevel, ["merge-base", "--is-ancestor", mergeHead, "HEAD"])).ok;
      if (!related) mainConflicts = null;
    }
    return { linkedWorktree, conflicts, mainConflicts, incoming: [] };
  }

  const branch = await gitOut(toplevel, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const incoming = branch ? await readIncoming({ toplevel, commonDir, branch }) : [];
  return { linkedWorktree, conflicts, mainConflicts: null, incoming };
}
