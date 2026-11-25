import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnProcess } from "@getpaseo/plugin/server";
import type { PiModelsTestOutput } from "@getpaseo/protocol/pi-models";

const LIST_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 120_000;
const TEST_PROMPT = "Reply with exactly: ok";

/** `pi` on the daemon's PATH, else the installer's ~/.local/bin/pi. */
export async function resolvePiBinary(): Promise<string | null> {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  dirs.push(join(homedir(), ".local", "bin"));
  for (const dir of dirs) {
    const candidate = join(dir, "pi");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // next
    }
  }
  return null;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
}

// stdin is closed on purpose: `pi -p` with an open stdin pipe waits for input forever.
async function runPi(args: string[], timeoutMs: number): Promise<RunResult | null> {
  const binary = await resolvePiBinary();
  if (!binary) return null;
  const started = Date.now();
  const child = spawnProcess(binary, args, {
    cwd: tmpdir(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  const closed = new Promise<number | null>((resolveClose) => child.once("close", resolveClose));
  const failed = new Promise<null>((resolveError) =>
    child.once("error", (error) => {
      stderr += error.message;
      resolveError(null);
    }),
  );
  const code = await Promise.race([closed, failed]);
  clearTimeout(timer);
  return { code, stdout, stderr, timedOut, ms: Date.now() - started };
}

export async function listModels(): Promise<string> {
  const result = await runPi(["--list-models"], LIST_TIMEOUT_MS);
  if (!result) return "pi not found on the daemon's PATH or in ~/.local/bin.";
  if (result.timedOut) return "pi --list-models timed out.";
  return `${result.stdout}${result.stderr}`.trim();
}

export async function testModel(input: {
  provider: string;
  model: string;
  thinking?: string;
}): Promise<PiModelsTestOutput> {
  const args = ["--no-session", "--model", `${input.provider}/${input.model}`];
  if (input.thinking) args.push("--thinking", input.thinking);
  args.push("-p", TEST_PROMPT);
  const result = await runPi(args, TEST_TIMEOUT_MS);
  if (!result) return { ok: false, output: "pi not found on the daemon's PATH.", ms: 0 };
  if (result.timedOut)
    return { ok: false, output: `No answer in ${TEST_TIMEOUT_MS / 1000} s.`, ms: result.ms };
  const output = `${result.stdout}${result.code === 0 ? "" : result.stderr}`.trim();
  return {
    ok: result.code === 0,
    output: output || `pi exited with ${result.code}`,
    ms: result.ms,
  };
}
