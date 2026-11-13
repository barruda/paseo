// CUSTOM(claude-stt): the Claude.ai login that Claude Code keeps in
// `<config dir>/.credentials.json`. Claude Code refreshes the token while it runs; when it has
// expired (no Claude session for ~8 h) we refresh it the way Claude Code does and write it back,
// so every Claude Code process that shares the folder keeps working.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type pino from "pino";

const CREDENTIALS_FILE = ".credentials.json";
// Claude Code's OAuth client and token endpoint (claude-cli 2.1.x).
const OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const REFRESH_MARGIN_MS = 60_000;
const REFRESH_TIMEOUT_MS = 15_000;

interface ClaudeAiOauth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  subscriptionType?: string | null;
  [key: string]: unknown;
}

interface CredentialsFile {
  claudeAiOauth?: ClaudeAiOauth;
  [key: string]: unknown;
}

export interface ClaudeCredentialStatus {
  configDir: string;
  credentialsPath: string;
  signedIn: boolean;
  subscriptionType: string | null;
  // ISO time the access token expires; we refresh it on the next use after that.
  expiresAt: string | null;
  error: string | null;
}

export class ClaudeCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeCredentialsError";
  }
}

export function resolveClaudeConfigDir(
  configDir: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw =
    configDir?.trim() || env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude");
  return raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
}

function credentialsPathFor(configDir: string): string {
  return path.join(configDir, CREDENTIALS_FILE);
}

async function readCredentials(credentialsPath: string): Promise<CredentialsFile> {
  let raw: string;
  try {
    raw = await fs.readFile(credentialsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ClaudeCredentialsError(
        `No Claude login in ${credentialsPath}. Run \`claude\` and /login with a Claude.ai account.`,
      );
    }
    throw error;
  }
  try {
    return JSON.parse(raw) as CredentialsFile;
  } catch {
    throw new ClaudeCredentialsError(`${credentialsPath} is not valid JSON.`);
  }
}

function requireOauth(file: CredentialsFile, credentialsPath: string): ClaudeAiOauth {
  const oauth = file.claudeAiOauth;
  if (!oauth?.accessToken) {
    throw new ClaudeCredentialsError(
      `${credentialsPath} has no Claude.ai login (an API key login can't use voice).`,
    );
  }
  return oauth;
}

function isFresh(oauth: ClaudeAiOauth, now: number): boolean {
  return typeof oauth.expiresAt !== "number" || oauth.expiresAt - REFRESH_MARGIN_MS > now;
}

export async function getClaudeCredentialStatus(
  configDir: string,
): Promise<ClaudeCredentialStatus> {
  const credentialsPath = credentialsPathFor(configDir);
  const base = { configDir, credentialsPath };
  try {
    const oauth = requireOauth(await readCredentials(credentialsPath), credentialsPath);
    return {
      ...base,
      signedIn: true,
      subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : null,
      expiresAt:
        typeof oauth.expiresAt === "number" ? new Date(oauth.expiresAt).toISOString() : null,
      error: oauth.refreshToken || isFresh(oauth, Date.now()) ? null : "The login expired.",
    };
  } catch (error) {
    return {
      ...base,
      signedIn: false,
      subscriptionType: null,
      expiresAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// One refresh per credentials file at a time; concurrent callers share it.
const refreshesInFlight = new Map<string, Promise<string>>();

export async function getClaudeAccessToken(
  configDir: string,
  logger: pino.Logger,
): Promise<string> {
  const credentialsPath = credentialsPathFor(configDir);
  const oauth = requireOauth(await readCredentials(credentialsPath), credentialsPath);
  if (isFresh(oauth, Date.now())) {
    return oauth.accessToken!;
  }
  const inFlight = refreshesInFlight.get(credentialsPath);
  if (inFlight) {
    return inFlight;
  }
  const refresh = refreshAccessToken(credentialsPath, logger).finally(() => {
    refreshesInFlight.delete(credentialsPath);
  });
  refreshesInFlight.set(credentialsPath, refresh);
  return refresh;
}

async function refreshAccessToken(credentialsPath: string, logger: pino.Logger): Promise<string> {
  const before = requireOauth(await readCredentials(credentialsPath), credentialsPath);
  if (isFresh(before, Date.now())) {
    return before.accessToken!;
  }
  if (!before.refreshToken) {
    throw new ClaudeCredentialsError(
      `The Claude login in ${credentialsPath} expired. Open \`claude\` once to renew it.`,
    );
  }
  logger.info({ credentialsPath }, "Refreshing the expired Claude login for speech-to-text");
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: before.refreshToken,
      client_id: OAUTH_CLIENT_ID,
      ...(before.scopes?.length ? { scope: before.scopes.join(" ") } : {}),
    }),
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
  });
  if (!response.ok) {
    // Claude Code may have refreshed it meanwhile with the same refresh token.
    const current = requireOauth(await readCredentials(credentialsPath), credentialsPath);
    if (isFresh(current, Date.now())) {
      return current.accessToken!;
    }
    throw new ClaudeCredentialsError(
      `Renewing the Claude login failed (HTTP ${response.status}). Open \`claude\` once to renew it.`,
    );
  }
  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!body.access_token || typeof body.expires_in !== "number") {
    throw new ClaudeCredentialsError("Renewing the Claude login returned no token.");
  }

  // Re-read right before writing so we keep whatever else changed in the file.
  const latest = await readCredentials(credentialsPath);
  const latestOauth = latest.claudeAiOauth ?? {};
  if (latestOauth.refreshToken && latestOauth.refreshToken !== before.refreshToken) {
    // Another process refreshed while we were waiting; its token is as good as ours.
    if (latestOauth.accessToken && isFresh(latestOauth, Date.now())) {
      return latestOauth.accessToken;
    }
  }
  const next: CredentialsFile = {
    ...latest,
    claudeAiOauth: {
      ...latestOauth,
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? before.refreshToken,
      expiresAt: Date.now() + body.expires_in * 1000,
    },
  };
  const tmpPath = `${credentialsPath}.paseo-${process.pid}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(next), { mode: 0o600 });
  await fs.rename(tmpPath, credentialsPath);
  return body.access_token;
}
