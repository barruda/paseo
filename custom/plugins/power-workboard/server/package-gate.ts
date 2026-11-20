// CUSTOM(packages): the package gate. It runs a project's full suite once per package, by script
// (never an agent), in a dedicated git worktree so it never moves or dirties the user's checkout.
// A failed run bisects the package's merges and points at the first suspect.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type {
  Finish,
  Package,
  PackageRun,
  PackageTrigger,
  Task,
} from "../shared/model";
import { PACKAGE_OUTPUT_LIMIT } from "../shared/model";
import type { ProjectPolicy } from "../shared/assistant";
import {
  findFirstFailing,
  missingGateEnv,
  packageTaskOrder,
  resolvePackageGate,
} from "../shared/packages";
import type { VerifyRunner } from "./assistant/delivery";
import { runVerify } from "./assistant/delivery";
import { resolveBase } from "./assistant/task-git";

const execute = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;
const GATE_TIMEOUT_MS = 60 * 60_000;

export type GitExec = (
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
) => Promise<string>;

/** `git -C <cwd> ...`, with no terminal prompt and no optional locks. */
export const runGit: GitExec = async (args, options = {}) => {
  const { stdout } = await execute(
    "git",
    ["-c", "core.quotepath=off", ...args],
    {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
      },
    },
  );
  return stdout;
};

/** `<PASEO_HOME>/plugin-data/power-workboard/gates`, next to the profiles and history folders. */
export function defaultGateDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  const home = raw.startsWith("~")
    ? path.join(os.homedir(), raw.slice(1))
    : raw;
  return path.join(
    path.resolve(home),
    "plugin-data",
    "power-workboard",
    "gates",
  );
}

/** The paths a ticket changed against its base, for the risk rule. */
export async function changedPaths(
  directory: string,
  policyBase: string | null,
  exec: GitExec = runGit,
): Promise<string[]> {
  const base = await resolveBase(directory, policyBase);
  if (!base) return [];
  const mergeBase = (
    await exec(["-C", directory, "merge-base", base.ref, "HEAD"])
  ).trim();
  if (!mergeBase) return [];
  const output = await exec([
    "-C",
    directory,
    "diff",
    "--name-only",
    "--no-renames",
    mergeBase,
  ]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The integration commit of a package: its branch when set, else the project's base tip. */
export async function integrationCommit(
  pkg: Package,
  projectDirectory: string,
  policy: ProjectPolicy,
  exec: GitExec = runGit,
): Promise<string> {
  const ref = pkg.branch?.trim() || policy.baseBranch.trim() || "HEAD";
  return (
    await exec(["-C", projectDirectory, "rev-parse", `${ref}^{commit}`])
  ).trim();
}

export interface PackageMerge {
  taskId: string;
  number: number;
  commit: string;
  mergedAt: string;
}

/** The package's merged tickets in merge order, each with its merge commit. */
export function packageMerges(
  tasks: readonly Task[],
  finishes: Readonly<Record<string, Finish>>,
  packageId: string,
): PackageMerge[] {
  return packageTaskOrder(tasks, finishes, packageId)
    .map((task) => {
      const finish = finishes[task.id];
      if (!finish?.mergeCommit || !finish.mergedAt) return null;
      return {
        taskId: task.id,
        number: task.number,
        commit: finish.mergeCommit,
        mergedAt: finish.mergedAt,
      };
    })
    .filter((merge): merge is PackageMerge => merge !== null);
}

export type GateAttempt = "passed" | "failed" | "error";

/**
 * The first merge whose gate fails, assuming the package was green before. `runAt` checks out a
 * commit and runs the gate there; an `error` (missing setup, git failure) stops the search.
 */
export async function bisectPackage(
  merges: readonly PackageMerge[],
  runAt: (merge: PackageMerge) => Promise<GateAttempt>,
): Promise<{ suspect: PackageMerge | null; error: string | null }> {
  if (!merges.length) return { suspect: null, error: null };
  let failed: string | null = null;
  const index = await findFirstFailing(merges, async (merge) => {
    const result = await runAt(merge);
    if (result === "error") {
      failed = `Gate could not run at ${merge.commit.slice(0, 8)}.`;
      return true;
    }
    return result === "passed";
  });
  if (failed) return { suspect: null, error: failed };
  return { suspect: index === null ? null : merges[index]!, error: null };
}

export interface PackageGateInput {
  pkg: Package;
  project: { id: string; name: string; directory: string; isGit: boolean };
  policy: ProjectPolicy;
  tasks: readonly Task[];
  finishes: Readonly<Record<string, Finish>>;
  trigger: PackageTrigger;
  /** The commit of the last passed run, when there is one. */
  lastPassedCommit?: string | null;
  now?: string;
  env?: NodeJS.ProcessEnv;
  run?: VerifyRunner;
  exec?: GitExec;
  gateDirectory?: string;
}

function errorRun(
  input: PackageGateInput,
  status: PackageRun["status"],
  output: string,
): PackageRun {
  const now = input.now ?? new Date().toISOString();
  return {
    id: `pkgrun-${randomUUID().slice(0, 8)}`,
    packageId: input.pkg.id,
    trigger: input.trigger,
    status,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    commit: null,
    output: output.slice(-PACKAGE_OUTPUT_LIMIT),
    suspectTaskId: null,
    suspectCommit: null,
  };
}

/**
 * Runs the package's gate once. A missing required env or a missing command is a failure, never a
 * silent pass; a failed run bisects the package's merges.
 */
export async function runPackageGate(
  input: PackageGateInput,
): Promise<PackageRun> {
  const gate = resolvePackageGate(input.pkg, input.policy);
  if (!gate.command) {
    return errorRun(
      input,
      "error",
      "The package gate is not configured. Set the project's gate command or the package's.",
    );
  }
  const env = { ...(input.env ?? process.env), ...gate.env };
  const missing = missingGateEnv(gate, env);
  if (missing.length) {
    return errorRun(
      input,
      "missing-deps",
      `Missing required environment: ${missing.join(", ")}. The gate fails instead of letting suites skip.`,
    );
  }
  const exec = input.exec ?? runGit;
  const run = input.run ?? runVerify;
  const started = Date.now();
  const startedAt = input.now ?? new Date(started).toISOString();
  const gateDir = input.gateDirectory ?? defaultGateDirectory();
  const worktree = path.join(gateDir, input.pkg.id);
  const useWorktree = gate.runIn === "worktree" && input.project.isGit;
  let commit: string | null = null;
  try {
    if (input.project.isGit)
      commit = await integrationCommit(
        input.pkg,
        input.project.directory,
        input.policy,
        exec,
      );
    if (useWorktree && commit) {
      await mkdir(gateDir, { recursive: true });
      await checkoutWorktree(input.project.directory, worktree, commit, exec);
    }
    const directory = useWorktree ? worktree : input.project.directory;
    if (gate.setupCommand.trim()) {
      const setup = await run(gate.setupCommand, directory, {
        env,
        timeoutMs: GATE_TIMEOUT_MS,
      });
      if (!setup.passed) {
        return {
          ...errorRun(input, "error", `Setup failed:\n${setup.output}`),
          startedAt,
          commit,
          durationMs: Date.now() - started,
        };
      }
    }
    const result = await run(gate.command, directory, {
      env,
      timeoutMs: GATE_TIMEOUT_MS,
    });
    const baseRun: PackageRun = {
      id: `pkgrun-${randomUUID().slice(0, 8)}`,
      packageId: input.pkg.id,
      trigger: input.trigger,
      status: result.passed ? "passed" : "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      commit,
      output: result.output.slice(-PACKAGE_OUTPUT_LIMIT),
      suspectTaskId: null,
      suspectCommit: null,
    };
    if (result.passed) return baseRun;
    const merges = packageMerges(input.tasks, input.finishes, input.pkg.id);
    if (!merges.length) return baseRun;
    const runAt = async (merge: PackageMerge): Promise<GateAttempt> => {
      try {
        if (useWorktree)
          await checkoutWorktree(
            input.project.directory,
            worktree,
            merge.commit,
            exec,
          );
        if (gate.setupCommand.trim()) {
          const setup = await run(gate.setupCommand, directory, {
            env,
            timeoutMs: GATE_TIMEOUT_MS,
          });
          if (!setup.passed) return "error";
        }
        const check = await run(gate.command, directory, {
          env,
          timeoutMs: GATE_TIMEOUT_MS,
        });
        return check.passed ? "passed" : "failed";
      } catch {
        return "error";
      }
    };
    const bisect = await bisectPackage(merges, runAt);
    const suspect = bisect.suspect;
    return {
      ...baseRun,
      output: [
        baseRun.output,
        bisect.error ? `Bisect: ${bisect.error}` : "",
        suspect
          ? `First failing merge: #${suspect.number} (${suspect.taskId}) at ${suspect.commit.slice(0, 8)}.`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(-PACKAGE_OUTPUT_LIMIT),
      suspectTaskId: suspect?.taskId ?? null,
      suspectCommit: suspect?.commit ?? null,
    };
  } catch (error) {
    return {
      ...errorRun(
        input,
        "error",
        error instanceof Error ? error.message : String(error),
      ),
      startedAt,
      commit,
      durationMs: Date.now() - started,
    };
  }
}

async function checkoutWorktree(
  projectDirectory: string,
  worktree: string,
  commit: string,
  exec: GitExec,
): Promise<void> {
  if (!existsSync(worktree)) {
    await exec([
      "-C",
      projectDirectory,
      "worktree",
      "add",
      "--force",
      "--detach",
      worktree,
      commit,
    ]);
    return;
  }
  try {
    await exec(["-C", worktree, "checkout", "--detach", "--force", commit]);
  } catch {
    // A stale folder that is not a worktree: replace it with a fresh one.
    await exec([
      "-C",
      projectDirectory,
      "worktree",
      "remove",
      "--force",
      worktree,
    ]).catch(() => undefined);
    await exec([
      "-C",
      projectDirectory,
      "worktree",
      "add",
      "--force",
      "--detach",
      worktree,
      commit,
    ]);
  }
}
