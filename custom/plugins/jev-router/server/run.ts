import { spawn } from "node:child_process";
import os from "node:os";
import type { JevDecision, JevRouterSettings } from "@getpaseo/protocol/jev-router";
import { buildRouterArgs, expandHome, parseRouterOutput, type RouteHome } from "../shared/decision";

// Runs gnome-custom's route.py with the prompt on stdin. It always exits 0 and prints one JSON
// line, failing open (home model) on its own problems; this only throws when the script itself
// can't run or hangs past its timeout.

const KILL_AFTER_EXTRA_MS = 3000;

export function runRouter(input: {
  settings: JevRouterSettings;
  home: RouteHome;
  prompt: string;
  cwd: string;
  images: number;
  test: boolean;
}): Promise<JevDecision> {
  const homeDir = os.homedir();
  const args = buildRouterArgs({ ...input, homeDir });
  const env = { ...process.env };
  if (input.settings.apiKey.trim()) env.TYPESAFE_API_KEY = input.settings.apiKey.trim();
  return new Promise((resolve, reject) => {
    const child = spawn(expandHome(input.settings.python, homeDir), args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
        reject(new Error(`route.py took longer than ${input.settings.timeoutSeconds}s + 3s`));
      },
      input.settings.timeoutSeconds * 1000 + KILL_AFTER_EXTRA_MS,
    );
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        resolve(parseRouterOutput(stdout));
      } catch (error) {
        const detail = stderr.trim().split("\n").slice(-3).join(" ");
        reject(new Error(`route.py exited ${code}: ${detail || (error as Error).message}`));
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input.prompt);
  });
}
