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
export type VerifyRunner = (
  command: string,
  directory: string,
) => Promise<VerifyResult>;

/** Runs `sh -c command` in the directory and keeps the tail of the combined output. */
export const runVerify: VerifyRunner = (command, directory) =>
  new Promise((resolve) => {
    let output = "";
    let settled = false;
    const finish = (result: VerifyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn("sh", ["-c", command], {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const take = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-VERIFY_OUTPUT_LIMIT);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      output =
        `${output}\nTimed out after ${VERIFY_TIMEOUT_MS / 60000} minutes`.slice(
          -VERIFY_OUTPUT_LIMIT,
        );
      finish({ passed: false, output });
    }, VERIFY_TIMEOUT_MS);
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
