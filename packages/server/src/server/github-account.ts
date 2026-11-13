// CUSTOM(github-account): which `gh` account this host uses. The launcher's GH_CONFIG_DIR is only
// the fallback; the daemon's own `daemon.github.configDir` setting wins over it.
import os from "node:os";
import { findExecutable } from "../executable-resolution/executable-resolution.js";
import { execCommand } from "../utils/spawn.js";
import { resetShellEnvCache } from "./agent/provider-launch-config.js";

export type GithubAccountSource = "settings" | "launcher" | "default";

export interface GithubAccountStatus {
  configDir: string | null;
  source: GithubAccountSource;
  login: string | null;
  error: string | null;
}

const GH_STATUS_TIMEOUT_MS = 10_000;

// Captured once, before any setting is applied, so clearing the setting can restore it.
const launchGhConfigDir: string | undefined = normalizeEnvValue(process.env.GH_CONFIG_DIR);
let appliedSettingsDir: string | undefined;

function normalizeEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function expandHomeDir(value: string, homedir: string = os.homedir()): string {
  if (value === "~") return homedir;
  if (value.startsWith("~/")) return `${homedir}${value.slice(1)}`;
  return value;
}

export interface ResolvedGithubConfigDir {
  configDir: string | undefined;
  source: GithubAccountSource;
}

/** The settings value wins over the launcher's; neither means `gh` uses ~/.config/gh. */
export function resolveGithubConfigDir(input: {
  configured: string | undefined;
  launchValue: string | undefined;
  homedir?: string;
}): ResolvedGithubConfigDir {
  const configured = normalizeEnvValue(input.configured);
  if (configured) {
    return { configDir: expandHomeDir(configured, input.homedir), source: "settings" };
  }
  const launch = normalizeEnvValue(input.launchValue);
  if (launch) return { configDir: launch, source: "launcher" };
  return { configDir: undefined, source: "default" };
}

/** Sets GH_CONFIG_DIR in `env` (process.env by default) and returns what it resolved to. */
export function applyGithubConfigDir(
  configDir: string | undefined,
  options: { env?: NodeJS.ProcessEnv; launchValue?: string | undefined; homedir?: string } = {},
): ResolvedGithubConfigDir {
  const env = options.env ?? process.env;
  const launchValue = "launchValue" in options ? options.launchValue : launchGhConfigDir;
  const resolved = resolveGithubConfigDir({
    configured: configDir,
    launchValue,
    homedir: options.homedir,
  });
  if (resolved.configDir === undefined) delete env.GH_CONFIG_DIR;
  else env.GH_CONFIG_DIR = resolved.configDir;
  if (env === process.env) {
    appliedSettingsDir = resolved.source === "settings" ? resolved.configDir : undefined;
    // Agents and terminals inherit the cached shell env, so it has to be rebuilt.
    resetShellEnvCache();
  }
  return resolved;
}

function describeGhFailure(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; stderr?: unknown; message?: unknown };
    if (record.code === "ENOENT") return "The gh CLI is not installed on this host.";
    const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
    if (stderr) return stderr;
    if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  }
  return String(error);
}

/**
 * Who `gh` is signed in as. `configDir` undefined tests the effective directory; a string
 * tests that candidate (empty = the launcher's value) without applying it.
 */
export async function getGithubAccountStatus(
  input: { configDir?: string } = {},
): Promise<GithubAccountStatus> {
  const resolved =
    input.configDir === undefined
      ? resolveGithubConfigDir({
          configured: appliedSettingsDir,
          launchValue: normalizeEnvValue(process.env.GH_CONFIG_DIR),
        })
      : resolveGithubConfigDir({ configured: input.configDir, launchValue: launchGhConfigDir });
  const base = { configDir: resolved.configDir ?? null, source: resolved.source };
  try {
    const ghPath = await findExecutable("gh");
    if (!ghPath) {
      return { ...base, login: null, error: "The gh CLI is not installed on this host." };
    }
    const env: NodeJS.ProcessEnv = { ...process.env, GH_PROMPT_DISABLED: "1" };
    if (resolved.configDir === undefined) delete env.GH_CONFIG_DIR;
    else env.GH_CONFIG_DIR = resolved.configDir;
    const { stdout } = await execCommand(ghPath, ["api", "user", "--jq", ".login"], {
      env,
      timeout: GH_STATUS_TIMEOUT_MS,
    });
    const login = stdout.trim();
    return login
      ? { ...base, login, error: null }
      : { ...base, login: null, error: "gh returned no login." };
  } catch (error) {
    return { ...base, login: null, error: describeGhFailure(error) };
  }
}
