// CUSTOM(projects-assistant): pieces of the delivery pipeline that do not touch the board's data:
// the verify runner, the per-project merge lock and the classification of merge errors.
import { spawn } from "node:child_process";
import type { NeedsYouReason } from "../../shared/assistant";

export const VERIFY_TIMEOUT_MS = 10 * 60 * 1000;
export const VERIFY_OUTPUT_LIMIT = 8 * 1024;

export interface VerifyResult {
  passed: boolean;
  output: string;
}
/** CUSTOM(packages): the gate needs extra env and a longer timeout than a merge check. */
export interface VerifyOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** CUSTOM(packages): a gate run is canceled on dispose. */
  signal?: AbortSignal;
}
export type VerifyRunner = (
  command: string,
  directory: string,
  options?: VerifyOptions,
) => Promise<VerifyResult>;

/** Runs `sh -c command` in the directory and keeps the tail of the combined output. */
export const runVerify: VerifyRunner = (command, directory, options = {}) =>
  new Promise((resolve) => {
    let output = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      child.kill("SIGKILL");
      finish({ passed: false, output: `${output}\nCanceled`.trim() });
    };
    const finish = (result: VerifyResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const child = spawn("sh", ["-c", command], {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    const take = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-VERIFY_OUTPUT_LIMIT);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timeout = options.timeoutMs ?? VERIFY_TIMEOUT_MS;
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      output = `${output}\nTimed out after ${timeout / 60000} minutes`.slice(
        -VERIFY_OUTPUT_LIMIT,
      );
      finish({ passed: false, output });
    }, timeout);
    options.signal?.addEventListener("abort", onAbort);
    if (options.signal?.aborted) onAbort();
    child.on("error", (error) =>
      finish({ passed: false, output: `${output}\n${error.message}`.trim() }),
    );
    child.on("close", (code) => finish({ passed: code === 0, output }));
  });

/** One merge at a time per key (a project's checkout). */
export class KeyedLock {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(work, work);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

/** A merge that had nothing left to merge is a success. */
export function isUpToDate(error: string): boolean {
  return /already up[- ]to[- ]date|nothing to merge/i.test(error);
}

export function classifyMergeError(
  error: string,
): Extract<
  NeedsYouReason,
  "merge-conflict" | "dirty-checkout" | "merge-error"
> {
  if (/conflict/i.test(error)) return "merge-conflict";
  if (/dirty|uncommitted|clean|unstaged|local changes/i.test(error))
    return "dirty-checkout";
  return "merge-error";
}

/** Folders that hold installed dependencies. The delivery never commits one. */
const DEPENDENCY_DIRS = new Set([
  "node_modules",
  "bower_components",
  "jspm_packages",
  ".venv",
  "venv",
  "__pypackages__",
  ".tox",
  ".pnpm-store",
]);

/**
 * The new paths in `git status --porcelain` lines (untracked, or added to the index) that are a
 * dependency folder or sit inside one. A `node_modules/` ignore rule matches directories only, so
 * a symlinked `node_modules` shows up here as a new file, and the delivery commit stages every
 * new file.
 */
export function newDependencyPaths(lines: string[]): string[] {
  const found: string[] = [];
  for (const line of lines) {
    const code = line.slice(0, 2);
    if (code !== "??" && code[0] !== "A") continue;
    let path = line.slice(3).trim();
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    path = path.replace(/\/+$/, "");
    if (path.split("/").some((segment) => DEPENDENCY_DIRS.has(segment)))
      found.push(path);
  }
  return found;
}

/** Why the delivery refuses to commit these status lines, or null when it may. */
export function dependencyRefusal(lines: string[]): string | null {
  const paths = newDependencyPaths(lines);
  if (!paths.length) return null;
  const shown = paths.slice(0, 5).join(", ");
  const more = paths.length > 5 ? ` and ${paths.length - 5} more` : "";
  return `Not committed: untracked dependency paths would enter the commit (${shown}${more}). A symlinked node_modules is a file to git, so a node_modules/ ignore rule misses it. Replace it with a real install in the worktree (or ignore it), then deliver again.`;
}

/**
 * CUSTOM(orchestrator-in-place): the paths of one `git status --porcelain` (v1) line. A rename or
 * copy gives both paths, old first. C-quoted paths (spaces, non-ASCII under `core.quotePath`)
 * come back as the real file names, ready for literal pathspecs.
 */
export function porcelainPaths(line: string): string[] {
  const code = line.slice(0, 2);
  const rest = line.slice(3);
  const twoPaths = code.includes("R") || code.includes("C");
  const paths: string[] = [];
  let index = 0;
  while (index < rest.length) {
    let path: string;
    if (rest[index] === '"') {
      const bytes: number[] = [];
      index += 1;
      while (index < rest.length && rest[index] !== '"') {
        const char = rest[index]!;
        if (char !== "\\") {
          bytes.push(...Buffer.from(char, "utf8"));
          index += 1;
          continue;
        }
        const next = rest[index + 1] ?? "";
        const octal = /^[0-7]{3}/.exec(rest.slice(index + 1, index + 4));
        if (octal) {
          bytes.push(parseInt(octal[0], 8));
          index += 4;
          continue;
        }
        const escapes: Record<string, number> = {
          a: 7,
          b: 8,
          t: 9,
          n: 10,
          v: 11,
          f: 12,
          r: 13,
        };
        bytes.push(escapes[next] ?? next.charCodeAt(0));
        index += 2;
      }
      index += 1;
      path = Buffer.from(bytes).toString("utf8");
    } else {
      const arrow = twoPaths ? rest.indexOf(" -> ", index) : -1;
      const end = arrow === -1 ? rest.length : arrow;
      path = rest.slice(index, end);
      index = end;
    }
    paths.push(path);
    if (!twoPaths || !rest.startsWith(" -> ", index)) break;
    index += 4;
  }
  return paths.filter((path) => path.length > 0);
}

export interface InPlaceCommitPlan {
  /** The status lines the commit takes: dirty now and not dirty when the task started. */
  lines: string[];
  /** Their paths, for `commit` (a rename gives both). */
  paths: string[];
  /** Paths left out because they were already uncommitted when the task started. */
  leftOut: string[];
  /** Left-out paths the agent's report also lists as changed: whose change is whose is unknown. */
  overlap: string[];
}

/** `path` is `dirty`, or sits in a directory that `git status` listed as dirty (`dir/`). */
function coveredBy(path: string, dirty: readonly string[]): boolean {
  return dirty.some(
    (entry) =>
      entry === path || (entry.endsWith("/") && path.startsWith(entry)),
  );
}

/** A report path relative to the folder, as `git status` prints it. */
function relativeReportPath(path: string, directory: string): string {
  const root = directory.replace(/\/+$/, "") + "/";
  let relative = path.trim();
  if (relative.startsWith(root)) relative = relative.slice(root.length);
  return relative.replace(/^(\.\/)+/, "");
}

/**
 * CUSTOM(orchestrator-in-place): the message of an in-place delivery commit: the task title, then
 * the agent's summary. The daemon would otherwise generate one from the diff of the whole folder,
 * which includes the user's uncommitted work that stays out of the commit.
 */
export function inPlaceCommitMessage(
  title: string,
  summary: string | null | undefined,
): string {
  const subject = title.split("\n")[0].trim() || "Task changes";
  const body = (summary ?? "").trim().slice(0, 4000);
  return body ? `${subject}\n\n${body}` : subject;
}

/**
 * CUSTOM(orchestrator-in-place): what an in-place delivery commits. The folder is the user's
 * checkout, so whatever was uncommitted when the task started stays out of the commit. A line
 * counts as the user's when any of its paths was dirty at the start (an untracked directory
 * covers the files under it). Paths that were dirty before and that the agent also reports as
 * changed hold both people's work in one file; they go to `overlap` for the user to sort out.
 */
export function inPlaceCommitPlan(input: {
  current: readonly string[];
  initialDirty: readonly string[];
  filesChanged: readonly string[];
  directory: string;
}): InPlaceCommitPlan {
  const before = input.initialDirty.flatMap(porcelainPaths);
  const reported = input.filesChanged
    .map((path) => relativeReportPath(path, input.directory))
    .filter((path) => path.length > 0);
  const plan: InPlaceCommitPlan = {
    lines: [],
    paths: [],
    leftOut: [],
    overlap: [],
  };
  for (const line of input.current) {
    const paths = porcelainPaths(line);
    if (!paths.length) continue;
    const old = paths.filter((path) => coveredBy(path, before));
    if (!old.length) {
      plan.lines.push(line);
      plan.paths.push(...paths);
      continue;
    }
    plan.leftOut.push(...old);
    for (const path of old)
      if (reported.some((file) => file === path || coveredBy(file, [path])))
        plan.overlap.push(path);
  }
  return plan;
}
