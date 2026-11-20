// CUSTOM(redeploy-button): launches custom/bin/build-paseo-if-needed-and-kill-daemons.sh. Its
// foreground part returns in ~1-2 s after handing the work to a transient systemd user service;
// the daemon (this plugin included) is restarted by that service afterwards.
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT_NAME = "build-paseo-if-needed-and-kill-daemons.sh";
const TIMEOUT_MS = 60_000;

export interface RedeployResult {
  ok: boolean;
  output: string;
}

function executable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The daemon evaluates the plugin as a bundled CJS string, so neither `import.meta.url` nor
 * `__dirname` is the plugin directory there (and the host passes none). `__dirname` is used
 * when something defines it (source loading, vitest); otherwise only the ~/.local/bin link
 * is tried.
 */
export function defaultScriptCandidates(): string[] {
  const candidates: string[] = [];
  if (typeof __dirname === "string") {
    candidates.push(path.resolve(__dirname, "..", "..", "..", "bin", SCRIPT_NAME));
  }
  candidates.push(path.join(os.homedir(), ".local", "bin", SCRIPT_NAME));
  return candidates;
}

export function redeployPaseo(
  options: { scripts?: string[] } = {},
): Promise<RedeployResult> {
  const scripts = options.scripts ?? defaultScriptCandidates();
  const script = scripts.find(executable);
  if (!script) {
    return Promise.resolve({
      ok: false,
      output: `Redeploy script not found or not executable: ${scripts.join(", ")}`,
    });
  }
  const env = { ...process.env };
  delete env.PASEO_AGENT_ID;
  return new Promise((resolve) => {
    execFile(
      script,
      [],
      { env, timeout: TIMEOUT_MS, encoding: "utf8" },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ""}${stderr ?? ""}`.trim();
        if (!error) {
          resolve({ ok: true, output });
          return;
        }
        resolve({ ok: false, output: output || error.message });
      },
    );
  });
}
