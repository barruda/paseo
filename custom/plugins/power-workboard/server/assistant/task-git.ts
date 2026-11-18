// CUSTOM(projects-assistant): read-only git views of a task's worktree for the assistant chat
// (board_get_task and board_task_diff), so it can review a task without guessing paths.
// Never writes: no index refresh (GIT_OPTIONAL_LOCKS=0), no `add -N`, no stash. Renames show as
// delete + add (`--no-renames`) so every diffstat path works as a `path` filter.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

const COMMIT_LIST_LIMIT = 20;
export const DEFAULT_DIFF_BYTES = 60_000;
export const MAX_DIFF_BYTES = 400_000;

/** Where the base came from: the project's delivery policy or the worktree Paseo created. */
export type BaseSource = "project policy" | "worktree metadata";

export interface TaskCheckout {
  directory: string;
  /** The project's `baseBranch` delivery policy, when set; it wins over the worktree's own base. */
  policyBase: string | null;
}

interface GitError {
  code?: number;
  stdout?: string;
  stderr?: string;
}

async function git(
  directory: string,
  args: string[],
  { allowExitOne = false } = {},
): Promise<string> {
  try {
    const { stdout } = await execute(
      "git",
      ["-C", directory, "-c", "core.quotepath=off", ...args],
      {
        timeout: 20_000,
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
        },
      },
    );
    return stdout;
  } catch (error) {
    const failure = error as GitError;
    // `diff --no-index` exits 1 when the files differ.
    if (allowExitOne && failure.code === 1 && failure.stdout !== undefined)
      return failure.stdout;
    const reason = failure.stderr?.trim() || (error as Error).message;
    throw new Error(`git ${args[0]}: ${reason}`);
  }
}

/**
 * The base a merge of this worktree would use: the policy's `baseBranch`, else the ref the
 * daemon stored when it created the worktree (`<git dir>/paseo/worktree.json`, the same
 * `baseRef ?? baseRefName` the daemon's checkout_merge falls back to).
 */
async function resolveBase(
  directory: string,
  policyBase: string | null,
): Promise<{ ref: string; source: BaseSource } | null> {
  if (policyBase?.trim())
    return { ref: policyBase.trim(), source: "project policy" };
  try {
    const gitDir = (
      await git(directory, ["rev-parse", "--absolute-git-dir"])
    ).trim();
    const metadata = JSON.parse(
      await readFile(path.join(gitDir, "paseo", "worktree.json"), "utf8"),
    ) as { baseRef?: unknown; baseRefName?: unknown };
    const ref = metadata.baseRef ?? metadata.baseRefName;
    return typeof ref === "string" && ref
      ? { ref, source: "worktree metadata" }
      : null;
  } catch {
    return null;
  }
}

const shortRef = (ref: string) =>
  ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\//, "");

/** CUSTOM(assistant-autonomy): the base branch's short name for a worktree, or "" when unknown. */
export async function worktreeBaseName(
  directory: string,
  policyBase: string | null,
): Promise<string> {
  const base = await resolveBase(directory, policyBase);
  return base ? shortRef(base.ref) : "";
}

interface FileStat {
  path: string;
  added: number | null;
  removed: number | null;
  untracked: boolean;
}

export interface TaskGitState {
  directory: string;
  branch: string;
  base: { ref: string; source: BaseSource } | null;
  /** Null when there is no base or it does not resolve. */
  mergeBase: string | null;
  baseError: string | null;
  ahead: number | null;
  behind: number | null;
  commits: string[];
  uncommitted: number;
  files: FileStat[];
}

async function untrackedFiles(
  directory: string,
  pathFilter?: string,
): Promise<string[]> {
  const out = await git(directory, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    ...(pathFilter ? ["--", pathFilter] : []),
  ]);
  return out.split("\0").filter(Boolean);
}

const numstatLine = (line: string): FileStat | null => {
  const [added, removed, ...rest] = line.split("\t");
  const file = rest.join("\t");
  if (!file) return null;
  return {
    path: file,
    added: added === "-" ? null : Number(added),
    removed: removed === "-" ? null : Number(removed),
    untracked: false,
  };
};

/** What `git diff --numstat` counts for a new file: its lines, or null when it is binary. */
async function countLines(file: string): Promise<number | null> {
  let content: Buffer;
  try {
    content = await readFile(file);
  } catch {
    return null;
  }
  // Git's own heuristic: a NUL byte in the first 8000 bytes means binary.
  if (content.subarray(0, 8000).includes(0)) return null;
  if (!content.length) return 0;
  let lines = 0;
  for (const byte of content) if (byte === 10) lines++;
  return content[content.length - 1] === 10 ? lines : lines + 1;
}

/** Branch, base, commits ahead and the diffstat (commits, uncommitted and new files) of a worktree. */
export async function taskGitState(
  checkout: TaskCheckout,
  pathFilter?: string,
): Promise<TaskGitState> {
  const { directory } = checkout;
  const root = (await git(directory, ["rev-parse", "--show-toplevel"])).trim();
  let branch: string;
  try {
    branch = (
      await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])
    ).trim();
  } catch {
    const head = (await git(root, ["rev-parse", "--short", "HEAD"])).trim();
    branch = `(detached at ${head})`;
  }
  const base = await resolveBase(root, checkout.policyBase);
  let mergeBase: string | null = null;
  let baseError: string | null = null;
  if (base) {
    try {
      mergeBase = (await git(root, ["merge-base", base.ref, "HEAD"])).trim();
    } catch (error) {
      baseError = (error as Error).message;
    }
  }
  let ahead: number | null = null;
  let behind: number | null = null;
  let commits: string[] = [];
  if (base && mergeBase) {
    const [left, right] = (
      await git(root, [
        "rev-list",
        "--left-right",
        "--count",
        `${base.ref}...HEAD`,
      ])
    )
      .trim()
      .split(/\s+/)
      .map(Number);
    behind = left;
    ahead = right;
    commits = (
      await git(root, [
        "log",
        "--no-decorate",
        "--format=%h %s",
        `-${COMMIT_LIST_LIMIT}`,
        `${base.ref}..HEAD`,
      ])
    )
      .split("\n")
      .filter(Boolean);
  }
  const filter = pathFilter ? ["--", pathFilter] : [];
  // Against the merge-base, the working tree diff holds the commits and the uncommitted edits.
  const tracked = (
    await git(root, [
      "diff",
      "--no-ext-diff",
      "--no-renames",
      "--numstat",
      mergeBase ?? "HEAD",
      ...filter,
    ])
  )
    .split("\n")
    .map(numstatLine)
    .filter((stat): stat is FileStat => stat !== null);
  const untracked: FileStat[] = [];
  for (const file of await untrackedFiles(root, pathFilter))
    untracked.push({
      path: file,
      added: await countLines(path.join(root, file)),
      removed: 0,
      untracked: true,
    });
  const uncommitted = (
    await git(root, ["status", "--porcelain=v1", "--untracked-files=all"])
  )
    .split("\n")
    .filter(Boolean).length;
  return {
    directory: root,
    branch,
    base,
    mergeBase,
    baseError,
    ahead,
    behind,
    commits,
    uncommitted,
    files: [...tracked, ...untracked],
  };
}

const counts = (f: FileStat) =>
  f.added === null ? "binary" : `+${f.added} -${f.removed ?? 0}`;

/** The text block board_get_task and board_task_diff start with. */
export function describeGitState(state: TaskGitState): string {
  const base = state.base
    ? `${shortRef(state.base.ref)} (${state.base.source})`
    : "unknown (no project base branch and no worktree metadata); the diff below is against HEAD, so it only shows uncommitted changes";
  const lines = [
    `Worktree: ${state.directory}`,
    `Branch: ${state.branch}`,
    `Base: ${base}`,
  ];
  if (state.baseError)
    lines.push(
      `Base does not resolve (${state.baseError}); the diff below is against HEAD`,
    );
  if (state.ahead !== null)
    lines.push(
      `Commits ahead of base: ${state.ahead} (behind: ${state.behind ?? 0})${
        state.commits.length
          ? `\n${state.commits.map((c) => `- ${c}`).join("\n")}${
              state.ahead > state.commits.length
                ? `\n- ... ${state.ahead - state.commits.length} more`
                : ""
            }`
          : ""
      }`,
    );
  lines.push(
    `Uncommitted: ${state.uncommitted ? `${state.uncommitted} files` : "none"}`,
  );
  const added = state.files.reduce((sum, f) => sum + (f.added ?? 0), 0);
  const removed = state.files.reduce((sum, f) => sum + (f.removed ?? 0), 0);
  lines.push(
    state.files.length
      ? `Diffstat (commits, uncommitted and new files): ${state.files.length} files, +${added} -${removed}\n${state.files
          .map(
            (f) =>
              `- ${f.path} | ${counts(f)}${f.untracked ? " (new, untracked)" : ""}`,
          )
          .join("\n")}`
      : "Diffstat: no changes",
  );
  return lines.join("\n");
}

export interface TaskDiff {
  state: TaskGitState;
  diff: string;
  /** The full diff's size; null when new files were left out once the limit was reached. */
  totalBytes: number | null;
  truncated: boolean;
}

/** The task's diff against the merge-base with its base: commits, uncommitted edits and new files. */
export async function taskDiff(
  checkout: TaskCheckout,
  options: { path?: string; maxBytes?: number } = {},
): Promise<TaskDiff> {
  const state = await taskGitState(checkout, options.path);
  const root = state.directory;
  const filter = options.path ? ["--", options.path] : [];
  const maxBytes = options.maxBytes ?? DEFAULT_DIFF_BYTES;
  let full = await git(root, [
    "diff",
    "--no-ext-diff",
    "--no-renames",
    "--no-color",
    state.mergeBase ?? "HEAD",
    ...filter,
  ]);
  let complete = true;
  for (const file of state.files.filter((f) => f.untracked)) {
    // Past the limit the rest would be cut anyway; skip spawning git for each new file.
    if (Buffer.byteLength(full, "utf8") > maxBytes) {
      complete = false;
      break;
    }
    full += await git(
      root,
      [
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--no-color",
        "--",
        "/dev/null",
        file.path,
      ],
      { allowExitOne: true },
    );
  }
  const bytes = Buffer.from(full, "utf8");
  if (bytes.length <= maxBytes)
    return { state, diff: full, totalBytes: bytes.length, truncated: false };
  // Cut on a line boundary so the model never sees half a line.
  let cut = bytes.subarray(0, maxBytes).toString("utf8");
  const lastNewline = cut.lastIndexOf("\n");
  if (lastNewline > 0) cut = cut.slice(0, lastNewline + 1);
  return {
    state,
    diff: cut,
    totalBytes: complete ? bytes.length : null,
    truncated: true,
  };
}
