import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  ClaudeCredentialsError,
  getClaudeAccessToken,
  getClaudeCredentialStatus,
  resolveClaudeConfigDir,
} from "./credentials.js";

const logger = pino({ level: "silent" });
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "paseo-claude-cred-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

async function writeCredentials(oauth: Record<string, unknown>, extra = {}): Promise<void> {
  await writeFile(
    path.join(dir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: oauth, ...extra }),
    { mode: 0o600 },
  );
}

async function readCredentials(): Promise<{
  mcpOAuth?: unknown;
  claudeAiOauth: Record<string, unknown> & { expiresAt: number };
}> {
  return JSON.parse(await readFile(path.join(dir, ".credentials.json"), "utf8"));
}

describe("getClaudeAccessToken", () => {
  test("returns a token that is still valid without calling the token endpoint", async () => {
    await writeCredentials({ accessToken: "fresh", expiresAt: Date.now() + 3_600_000 });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(getClaudeAccessToken(dir, logger)).resolves.toBe("fresh");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("refreshes an expired token once and writes it back, keeping the rest of the file", async () => {
    await writeCredentials(
      {
        accessToken: "old",
        refreshToken: "refresh-1",
        expiresAt: Date.now() - 1000,
        scopes: ["user:inference", "user:profile"],
        subscriptionType: "max",
      },
      { mcpOAuth: { keep: true } },
    );
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({
        grant_type: "refresh_token",
        refresh_token: "refresh-1",
        scope: "user:inference user:profile",
      });
      return new Response(
        JSON.stringify({ access_token: "new", refresh_token: "refresh-2", expires_in: 28_800 }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const [first, second] = await Promise.all([
      getClaudeAccessToken(dir, logger),
      getClaudeAccessToken(dir, logger),
    ]);
    expect([first, second]).toEqual(["new", "new"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const saved = await readCredentials();
    expect(saved.mcpOAuth).toEqual({ keep: true });
    expect(saved.claudeAiOauth).toMatchObject({
      accessToken: "new",
      refreshToken: "refresh-2",
      subscriptionType: "max",
    });
    expect(saved.claudeAiOauth.expiresAt).toBeGreaterThan(Date.now());
    expect((await stat(path.join(dir, ".credentials.json"))).mode & 0o777).toBe(0o600);
  });

  test("uses the token another process saved when its own refresh is refused", async () => {
    await writeCredentials({ accessToken: "old", refreshToken: "r", expiresAt: Date.now() - 1 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await writeCredentials({
          accessToken: "from-claude-code",
          refreshToken: "r2",
          expiresAt: Date.now() + 3_600_000,
        });
        return new Response("{}", { status: 400 });
      }),
    );

    await expect(getClaudeAccessToken(dir, logger)).resolves.toBe("from-claude-code");
  });

  test("explains a missing login", async () => {
    await expect(getClaudeAccessToken(dir, logger)).rejects.toBeInstanceOf(ClaudeCredentialsError);
    await writeCredentials({});
    await expect(getClaudeAccessToken(dir, logger)).rejects.toThrow(/no Claude.ai login/);
  });
});

describe("getClaudeCredentialStatus", () => {
  test("reports the account without exposing the token", async () => {
    const expiresAt = Date.now() + 3_600_000;
    await writeCredentials({ accessToken: "secret", subscriptionType: "max", expiresAt });

    const status = await getClaudeCredentialStatus(dir);
    expect(status).toEqual({
      configDir: dir,
      credentialsPath: path.join(dir, ".credentials.json"),
      signedIn: true,
      subscriptionType: "max",
      expiresAt: new Date(expiresAt).toISOString(),
      error: null,
    });
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  test("reports a missing login as an error", async () => {
    const status = await getClaudeCredentialStatus(dir);
    expect(status.signedIn).toBe(false);
    expect(status.error).toMatch(/No Claude login/);
  });
});

describe("resolveClaudeConfigDir", () => {
  test("prefers the setting, then CLAUDE_CONFIG_DIR, then ~/.claude", () => {
    expect(resolveClaudeConfigDir("/x", { CLAUDE_CONFIG_DIR: "/y" })).toBe("/x");
    expect(resolveClaudeConfigDir(undefined, { CLAUDE_CONFIG_DIR: "/y" })).toBe("/y");
    expect(resolveClaudeConfigDir("  ", {})).toBe(path.join(os.homedir(), ".claude"));
    expect(resolveClaudeConfigDir("~/.claude-personal", {})).toBe(
      path.join(os.homedir(), ".claude-personal"),
    );
  });
});
