import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPlan,
  detectAppRunning,
  executeSync,
  listHistory,
  resolveSyncPaths,
  rollbackSync,
  scrubCredentials,
  type SyncPaths,
} from "../server/sync";
import {
  CONFIG_UX_ALLOWLIST,
  DESKTOP_SETTINGS_ALLOWLIST,
  EXCLUDED_PLUGIN_SETTINGS,
  MAX_BACKUPS,
} from "../shared/model";

let root: string;
let paths: SyncPaths;

async function write(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function read(file: string): Promise<unknown> {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.lstat(file);
    return true;
  } catch {
    return false;
  }
}

function sourceConfig(threshold = 500) {
  return {
    version: 1,
    daemon: {
      listen: "127.0.0.1:6767",
      mcp: { injectIntoAgents: true },
      cors: { allowedOrigins: ["https://app.paseo.sh"] },
      relay: { enabled: true },
    },
    app: { baseUrl: "https://app.paseo.sh" },
    providers: { local: { modelsDir: "/home/bruno/projetos/paseo/.llm" } },
    agents: {
      providers: { claude: { env: { CLAUDE_CODE_ARTIFACT: "1" } } },
      autoArchiveClosedDays: 1,
    },
    pluginsEnabled: true,
    plugins: {
      lobby: {
        source: "directory",
        path: path.join(paths.sourceHome, "plugins/lobby/uuid/checkout"),
        enabled: true,
      },
      shared: {
        source: "directory",
        path: "/home/bruno/projetos/paseo/custom/plugins/shared",
        enabled: false,
      },
      "token-ledger": {
        source: "directory",
        path: "/home/bruno/projetos/paseo/custom/plugins/token-ledger",
        enabled: true,
      },
    },
    features: {
      dictation: {
        enabled: true,
        tuning: { silencePeakThreshold: threshold },
        stt: { provider: "openai", apiKey: "sk-personal" },
      },
      voiceMode: { enabled: true, turnDetection: { silenceMs: 2000 } },
      webUi: { enabled: true },
      experimental: { doNotCopy: true },
    },
  };
}

function targetConfig() {
  return {
    version: 1,
    daemon: {
      listen: "127.0.0.1:6768",
      mcp: { injectIntoAgents: false },
      browserTools: { enabled: true },
      cors: { allowedOrigins: [] },
      relay: { enabled: false },
    },
    app: { baseUrl: "https://app.paseo.sh" },
    providers: { local: { modelsDir: "/telus/models" } },
    agents: {
      providers: { codex: { enabled: false } },
      metadataGeneration: {
        providers: [{ provider: "claude", model: "haiku" }],
      },
    },
    pluginsEnabled: false,
    plugins: {
      keep: { source: "directory", path: "/repo/keep", enabled: true },
    },
    features: {
      dictation: { enabled: false, tuning: { silencePeakThreshold: 999 } },
      voiceMode: { enabled: true, turnDetection: { silenceMs: 4000 } },
      webUi: { enabled: false },
    },
  };
}

async function seed(): Promise<void> {
  await write(path.join(paths.sourceHome, "config.json"), sourceConfig());
  await fsp.mkdir(path.join(paths.sourceHome, "plugins/lobby/uuid/checkout"), {
    recursive: true,
  });
  await write(
    path.join(
      paths.sourceHome,
      "plugins/lobby/uuid/checkout/paseo-plugin.json",
    ),
    {
      id: "lobby",
    },
  );
  await write(
    path.join(paths.sourceHome, "plugins/lobby/uuid/checkout/.git/config"),
    { remote: "https://user:token@example.com/lobby.git" },
  );
  await fsp.writeFile(
    path.join(paths.sourceHome, "plugins/lobby/uuid/checkout/.env"),
    "TOKEN=s3cr3t\n",
  );
  // Data folder for a plugin whose source lives in the repo: must not travel.
  await fsp.mkdir(path.join(paths.sourceHome, "plugins/token-ledger"), {
    recursive: true,
  });
  await fsp.writeFile(
    path.join(paths.sourceHome, "plugins/token-ledger/ledger.jsonl"),
    '{"tokens":1}\n',
  );
  await write(path.join(paths.sourceHome, "plugins/sources.json"), {
    lobby: { kind: "git", remote: "https://user:token@example.com/lobby.git" },
  });
  await write(path.join(paths.sourceHome, "custom-plugins-applied.json"), [
    "lobby",
    "shared",
  ]);
  await write(
    path.join(
      paths.sourceHome,
      "plugin-settings/paseo-background/background.json",
    ),
    {
      version: 1,
      values: { imageOpacity: 0.2, blurRadius: 1 },
    },
  );
  await write(path.join(paths.sourceHome, "plugin-settings/tldr/prompt.json"), {
    version: 1,
    values: {
      prompt: "TLDR",
      apiToken: "do-not-copy",
      webhook: "https://user:secret@example.com/hook",
    },
  });
  await write(
    path.join(paths.sourceHome, "plugin-settings/foo2/arr.json"),
    [1, 2],
  );
  await write(
    path.join(paths.sourceHome, "plugin-settings/jev-router/router.json"),
    {
      version: 1,
      values: { enabled: true, apiKey: "source-secret", timeoutSeconds: 2 },
    },
  );
  await write(
    path.join(
      paths.sourceHome,
      "plugin-settings/power-workboard/workboard-data.json",
    ),
    {
      version: 9,
      values: {
        schemaVersion: 9,
        orchestrations: { task: { status: "done" } },
      },
    },
  );
  await write(path.join(paths.sourceHome, "plugin-settings/foo/creds.json"), {
    token: "x",
  });
  await fsp.mkdir(path.join(paths.sourceHome, "plugin-settings/foo"), {
    recursive: true,
  });
  await fsp.writeFile(
    path.join(paths.sourceHome, "plugin-settings/foo/notes.txt"),
    "hello",
  );
  await fsp.writeFile(
    path.join(paths.sourceHome, "plugin-settings/foo/settings.json.bak-1"),
    "{}\n",
  );
  for (const file of [
    "local-credential",
    "daemon-keypair.json",
    "push-tokens.json",
  ]) {
    await fsp.mkdir(paths.sourceHome, { recursive: true });
    await fsp.writeFile(path.join(paths.sourceHome, file), "secret\n");
  }
  await fsp.writeFile(
    path.join(paths.sourceHome, "server-id"),
    "srv_personal\n",
  );
  await fsp.writeFile(path.join(paths.sourceHome, "cli-client-id"), "cli-id\n");
  await write(path.join(paths.sourceHome, "agents/agent/record.json"), {
    id: "a",
  });
  await write(path.join(paths.sourceHome, "projects/p/project.json"), {
    id: "p",
  });
  await write(path.join(paths.sourceHome, "schedules/s.json"), { id: "s" });
  await write(path.join(paths.sourceHome, "runtime/state.json"), {
    running: true,
  });

  await fsp.mkdir(path.join(paths.targetHome, "plugins/lobby/uuid/checkout"), {
    recursive: true,
  });
  await fsp.writeFile(
    path.join(
      paths.targetHome,
      "plugins/lobby/uuid/checkout/stale-secret.json",
    ),
    "gone\n",
  );
  await write(path.join(paths.targetHome, "config.json"), targetConfig());
  await fsp.writeFile(
    path.join(paths.targetHome, "local-credential"),
    "telus-secret\n",
  );
  await write(
    path.join(
      paths.targetHome,
      "plugin-settings/paseo-background/background.json",
    ),
    {
      version: 1,
      values: { imageOpacity: 0.9 },
    },
  );
  await write(
    path.join(paths.targetHome, "plugin-settings/jev-router/router.json"),
    {
      version: 1,
      values: { enabled: false, apiKey: "telus-own-secret" },
    },
  );
  await write(path.join(paths.targetAppDir, "desktop-settings.json"), {
    version: 1,
    settings: {
      releaseChannel: "beta",
      notifications: { playSound: false },
      daemon: { manageBuiltInDaemon: true, keepRunningAfterQuit: false },
      tabs: { flexibleMovement: false },
    },
    migrations: { legacyRendererSettingsImported: false },
  });
  await write(path.join(paths.sourceAppDir, "desktop-settings.json"), {
    version: 1,
    settings: {
      releaseChannel: "stable",
      notifications: { playSound: true },
      daemon: { manageBuiltInDaemon: true, keepRunningAfterQuit: true },
      tabs: { flexibleMovement: true },
    },
    migrations: { legacyRendererSettingsImported: true },
  });
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "telus-sync-"));
  paths = {
    sourceHome: path.join(root, ".paseo"),
    targetHome: path.join(root, ".paseo-telus"),
    sourceAppDir: path.join(root, "Paseo"),
    targetAppDir: path.join(root, "Paseo-telus"),
    backupRoot: path.join(root, "backups"),
  };
  await fsp.mkdir(paths.sourceHome, { recursive: true });
  await fsp.mkdir(paths.targetHome, { recursive: true });
  await seed();
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe("resolveSyncPaths", () => {
  it("only enables the sync on the Personal home", () => {
    const personal = resolveSyncPaths({
      PASEO_HOME: path.join(root, ".paseo"),
      PASEO_TELUS_HOME: path.join(root, ".paseo-telus"),
      PASEO_APP_DIR: path.join(root, "Paseo"),
      PASEO_TELUS_APP_DIR: path.join(root, "Paseo-telus"),
      PASEO_TELUS_SYNC_BACKUP_ROOT: path.join(root, "backups"),
    });
    expect(personal.available).toBe(true);
    expect(personal.targetHome).toBe(path.join(root, ".paseo-telus"));

    const telus = resolveSyncPaths({
      PASEO_HOME: path.join(root, ".paseo-telus"),
      PASEO_TELUS_HOME: path.join(root, ".paseo"),
    });
    expect(telus.available).toBe(false);
    expect(telus.reason).toContain("Paseo Personal");
  });
});

describe("allowlists and exclusion lists", () => {
  it("allowlists only the features block and two desktop leaves", () => {
    expect(Object.keys(CONFIG_UX_ALLOWLIST)).toEqual(["features"]);
    expect(CONFIG_UX_ALLOWLIST.features).toEqual([
      "dictation",
      "voiceMode",
      "webUi",
    ]);
    expect(DESKTOP_SETTINGS_ALLOWLIST).toEqual([
      ["notifications", "playSound"],
      ["tabs", "flexibleMovement"],
    ]);
  });

  it("excludes plugin settings that hold execution data, model picks or credentials", () => {
    expect(Object.keys(EXCLUDED_PLUGIN_SETTINGS).sort()).toEqual([
      "delegation",
      "jev-router",
      "power-workboard",
    ]);
  });

  it("drops credential keys wherever they appear", () => {
    const { value, removed } = scrubCredentials({
      values: {
        prompt: "TLDR",
        apiKey: "x",
        nested: { authorization: "Bearer y", turns: [{ token: "z", ok: 1 }] },
      },
    });
    expect(removed).toEqual([
      "values.apiKey",
      "values.nested.authorization",
      "values.nested.turns[0].token",
    ]);
    expect(value).toEqual({
      values: { prompt: "TLDR", nested: { turns: [{ ok: 1 }] } },
    });
  });

  it("keeps settings that merely mention tokens or keys", () => {
    const { value, removed } = scrubCredentials({
      values: {
        maxTokens: 800,
        max_tokens: 512,
        tokenCount: 3,
        tokenizerPath: "/models/tokenizer.json",
        cachedKeys: ["a"],
        sortKey: "name",
        hotkey: "Ctrl+K",
        passwordPolicy: "strong",
        authorizationLevel: 2,
        openaiApiKey: "x",
        "api-key": "x",
        oauthToken: "x",
        githubToken: "x",
        jwtSecret: "x",
        dbPassword: "x",
        sshKey: "x",
        api_token: "x",
        proxyAuthorization: "x",
        auth: { provider: "claude", accessToken: "y" },
      },
    });
    expect(removed).toEqual([
      "values.openaiApiKey",
      "values.api-key",
      "values.oauthToken",
      "values.githubToken",
      "values.jwtSecret",
      "values.dbPassword",
      "values.sshKey",
      "values.api_token",
      "values.proxyAuthorization",
      "values.auth.accessToken",
    ]);
    expect(value).toEqual({
      values: {
        maxTokens: 800,
        max_tokens: 512,
        tokenCount: 3,
        tokenizerPath: "/models/tokenizer.json",
        cachedKeys: ["a"],
        sortKey: "name",
        hotkey: "Ctrl+K",
        passwordPolicy: "strong",
        authorizationLevel: 2,
        auth: { provider: "claude" },
      },
    });
  });
});

describe("sync", () => {
  it("copies only the checked categories, never credentials or execution data", async () => {
    const before = targetConfig();
    const result = await executeSync(paths, [
      "ux",
      "desktop",
      "pluginSettings",
    ]);
    expect(result.ok).toBe(true);
    expect(result.backupId).not.toBeNull();

    // UX: features came over, everything else in config.json did not.
    const config = (await read(
      path.join(paths.targetHome, "config.json"),
    )) as Record<string, unknown>;
    expect(config.features).toEqual({
      dictation: {
        enabled: true,
        tuning: { silencePeakThreshold: 500 },
        stt: { provider: "openai" },
      },
      voiceMode: { enabled: true, turnDetection: { silenceMs: 2000 } },
      webUi: { enabled: true },
    });
    expect(JSON.stringify(config)).not.toContain("sk-personal");
    expect(config.experimental).toBeUndefined();
    expect(config.daemon).toEqual(before.daemon);
    expect(config.providers).toEqual(before.providers);
    expect(config.agents).toEqual(before.agents);
    expect(config.plugins).toEqual(before.plugins);
    expect(config.pluginsEnabled).toBe(before.pluginsEnabled);

    // Desktop: only the two allowed leaves; keepRunningAfterQuit and the channel stay.
    const desktop = (await read(
      path.join(paths.targetAppDir, "desktop-settings.json"),
    )) as Record<string, Record<string, unknown>>;
    expect(desktop.settings.notifications).toEqual({ playSound: true });
    expect(desktop.settings.tabs).toEqual({ flexibleMovement: true });
    expect(desktop.settings.daemon).toEqual({
      manageBuiltInDaemon: true,
      keepRunningAfterQuit: false,
    });
    expect(desktop.settings.releaseChannel).toBe("beta");

    // Plugin settings: UX ones copied, credentials scrubbed, excluded plugins untouched.
    expect(
      await read(
        path.join(paths.targetHome, "plugin-settings/tldr/prompt.json"),
      ),
    ).toEqual({
      version: 1,
      values: { prompt: "TLDR", webhook: "https://example.com/hook" },
    });
    expect(
      await exists(
        path.join(paths.targetHome, "plugin-settings/foo2/arr.json"),
      ),
    ).toBe(false);
    expect(
      await read(
        path.join(
          paths.targetHome,
          "plugin-settings/paseo-background/background.json",
        ),
      ),
    ).toEqual({ version: 1, values: { imageOpacity: 0.2, blurRadius: 1 } });
    expect(
      await read(
        path.join(paths.targetHome, "plugin-settings/jev-router/router.json"),
      ),
    ).toEqual({
      version: 1,
      values: { enabled: false, apiKey: "telus-own-secret" },
    });
    expect(
      await exists(
        path.join(paths.targetHome, "plugin-settings/power-workboard"),
      ),
    ).toBe(false);
    expect(
      await exists(
        path.join(paths.targetHome, "plugin-settings/foo/creds.json"),
      ),
    ).toBe(false);
    expect(
      await exists(
        path.join(paths.targetHome, "plugin-settings/foo/notes.txt"),
      ),
    ).toBe(false);
    expect(
      await exists(
        path.join(paths.targetHome, "plugin-settings/foo/settings.json.bak-1"),
      ),
    ).toBe(false);

    // Credentials and execution data never appear in the target.
    for (const file of [
      "daemon-keypair.json",
      "push-tokens.json",
      "server-id",
      "cli-client-id",
      "agents/agent/record.json",
      "projects/p/project.json",
      "schedules/s.json",
      "runtime/state.json",
    ]) {
      expect(await exists(path.join(paths.targetHome, file))).toBe(false);
    }
    // The target's own credential is untouched.
    expect(
      await fsp.readFile(
        path.join(paths.targetHome, "local-credential"),
        "utf8",
      ),
    ).toBe("telus-secret\n");
    // A backup with a manifest exists.
    const manifest = await read(path.join(result.backupPath!, "manifest.json"));
    expect(manifest).toMatchObject({
      tool: "telus-sync",
      version: 1,
      copied: result.copied,
    });
  });

  it("syncs plugins and rewrites managed source paths into the Telus home", async () => {
    const result = await executeSync(paths, ["plugins"]);
    expect(result.ok).toBe(true);
    const config = (await read(path.join(paths.targetHome, "config.json"))) as {
      pluginsEnabled: boolean;
      plugins: Record<string, { path?: string; enabled: boolean }>;
    };
    expect(config.pluginsEnabled).toBe(true);
    expect(config.plugins.lobby.path).toBe(
      path.join(paths.targetHome, "plugins/lobby/uuid/checkout"),
    );
    expect(config.plugins.shared.path).toBe(
      "/home/bruno/projetos/paseo/custom/plugins/shared",
    );
    expect(config.plugins.shared.enabled).toBe(false);
    expect(
      await exists(
        path.join(
          paths.targetHome,
          "plugins/lobby/uuid/checkout/paseo-plugin.json",
        ),
      ),
    ).toBe(true);
    expect(
      await exists(
        path.join(paths.targetHome, "plugins/lobby/uuid/checkout/.git"),
      ),
    ).toBe(false);
    expect(
      await exists(
        path.join(paths.targetHome, "plugins/lobby/uuid/checkout/.env"),
      ),
    ).toBe(false);
    expect(
      await exists(
        path.join(
          paths.targetHome,
          "plugins/lobby/uuid/checkout/stale-secret.json",
        ),
      ),
    ).toBe(false);
    expect(
      await read(path.join(paths.targetHome, "plugins/sources.json")),
    ).toEqual({
      lobby: { kind: "git", remote: "https://example.com/lobby.git" },
    });
    // The token-ledger data folder is referenced through a repo path, so it does not travel.
    expect(
      await exists(path.join(paths.targetHome, "plugins/token-ledger")),
    ).toBe(false);
    expect(await exists(path.join(paths.targetHome, "plugins/.staging"))).toBe(
      false,
    );
    expect(
      await read(path.join(paths.targetHome, "custom-plugins-applied.json")),
    ).toEqual(["lobby", "shared"]);
  });

  it("copies nothing when the selection is already in sync", async () => {
    await executeSync(paths, ["ux"]);
    const second = await executeSync(paths, ["ux"]);
    expect(second.ok).toBe(true);
    expect(second.copied).toBe(0);
    expect(second.backupId).toBeNull();
  });

  it("does not rewrite a category whose preview is already the same", async () => {
    await executeSync(paths, ["desktop"]);
    const desktop = await read(
      path.join(paths.targetAppDir, "desktop-settings.json"),
    );
    const second = await executeSync(paths, ["desktop"]);
    expect(second.ok).toBe(true);
    expect(second.copied).toBe(0);
    expect(second.backupId).toBeNull();
    expect(
      await read(path.join(paths.targetAppDir, "desktop-settings.json")),
    ).toEqual(desktop);
  });

  it("refuses to overwrite a Telus file that is not a JSON object", async () => {
    const broken = "{ this is not json\n";
    await fsp.writeFile(path.join(paths.targetHome, "config.json"), broken);
    const result = await executeSync(paths, ["ux"]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Refusing to overwrite");
    expect(
      await fsp.readFile(path.join(paths.targetHome, "config.json"), "utf8"),
    ).toBe(broken);
  });

  it("keeps a credential only the Telus install has and never copies the Personal one", async () => {
    const base = targetConfig();
    const target = {
      ...base,
      features: {
        ...base.features,
        dictation: {
          ...base.features.dictation,
          stt: { apiKey: "telus-own-stt" },
        },
        voiceMode: {
          ...base.features.voiceMode,
          tts: { provider: "claude", apiKey: "telus-own-tts" },
        },
      },
    };
    await write(path.join(paths.targetHome, "config.json"), target);

    const plan = await buildPlan(paths, ["ux"]);
    const detail = plan.categories[0]?.items[0]?.detail ?? "";
    expect(detail).toContain("features.dictation.stt.apiKey");
    expect(detail).toContain("features.voiceMode.tts.apiKey");

    const result = await executeSync(paths, ["ux"]);
    expect(result.ok).toBe(true);
    const config = (await read(path.join(paths.targetHome, "config.json"))) as {
      features: Record<string, Record<string, unknown>>;
    };
    expect(config.features.dictation).toEqual({
      enabled: true,
      tuning: { silencePeakThreshold: 500 },
      stt: { provider: "openai", apiKey: "telus-own-stt" },
    });
    // A branch only Telus has stays whole, so its credential keeps the settings it needs.
    expect(config.features.voiceMode).toEqual({
      enabled: true,
      turnDetection: { silenceMs: 2000 },
      tts: { provider: "claude", apiKey: "telus-own-tts" },
    });
    expect(JSON.stringify(config)).not.toContain("sk-personal");

    // The kept credentials match the file, so the next run has nothing to write.
    const second = await executeSync(paths, ["ux"]);
    expect(second.copied).toBe(0);
    expect(second.backupId).toBeNull();
  });

  it("copies settings whose names mention tokens and skips credential file names", async () => {
    await write(
      path.join(paths.sourceHome, "plugin-settings/summarizer/config.json"),
      {
        version: 1,
        values: {
          maxTokens: 800,
          tokenizerPath: "/models/tokenizer.json",
          apiKey: "summarizer-personal-secret",
        },
      },
    );
    await write(
      path.join(paths.sourceHome, "plugin-settings/summarizer/tokenizer.json"),
      { version: 1, model: { type: "BPE" } },
    );
    for (const file of ["tokens.json", "apiToken.json", "oauth.json"]) {
      await write(
        path.join(paths.sourceHome, "plugin-settings/summarizer", file),
        { token: "x" },
      );
    }
    for (const file of ["token-usage.json", "password-policy.json"]) {
      await write(
        path.join(paths.sourceHome, "plugin-settings/summarizer", file),
        { version: 1 },
      );
    }

    const result = await executeSync(paths, ["pluginSettings"]);
    expect(result.ok).toBe(true);
    expect(
      await read(
        path.join(paths.targetHome, "plugin-settings/summarizer/config.json"),
      ),
    ).toEqual({
      version: 1,
      values: { maxTokens: 800, tokenizerPath: "/models/tokenizer.json" },
    });
    expect(
      await read(
        path.join(
          paths.targetHome,
          "plugin-settings/summarizer/tokenizer.json",
        ),
      ),
    ).toEqual({ version: 1, model: { type: "BPE" } });
    for (const file of ["tokens.json", "apiToken.json", "oauth.json"]) {
      expect(
        await exists(
          path.join(paths.targetHome, "plugin-settings/summarizer", file),
        ),
      ).toBe(false);
    }
    for (const file of ["token-usage.json", "password-policy.json"]) {
      expect(
        await read(
          path.join(paths.targetHome, "plugin-settings/summarizer", file),
        ),
      ).toEqual({ version: 1 });
    }
  });
});

async function deadProcessPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  if (!pid) throw new Error("The helper process did not start.");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return pid;
}

describe("preview", () => {
  it("shows each plugin's enabled state and path change", async () => {
    const target = targetConfig();
    (target.plugins as Record<string, unknown>).lobby = {
      source: "directory",
      path: path.join(paths.targetHome, "plugins/lobby/old"),
      enabled: false,
    };
    await write(path.join(paths.targetHome, "config.json"), target);

    const plan = await buildPlan(paths, ["plugins"]);
    const category = plan.categories[0]!;
    const lobby = category.items.find((item) => item.label === "plugins.lobby");
    expect(lobby?.status).toBe("changed");
    expect(lobby?.detail).toContain("enabled false → true");
    expect(lobby?.detail).toContain("path moved into the Telus home");
    expect(
      category.items.find((item) => item.label === "plugins.shared"),
    ).toMatchObject({ status: "new", detail: "disabled" });
    expect(
      category.items.find(
        (item) => item.label === "config.json · pluginsEnabled",
      ),
    ).toMatchObject({ status: "changed", detail: "On" });
    expect(
      category.items.find((item) => item.label === "plugins.keep"),
    ).toMatchObject({
      status: "changed",
      detail: "removed: not configured on the Personal side",
    });
  });

  it("records the theme and visuals decision in the desktop preview", async () => {
    const plan = await buildPlan(paths, ["desktop"]);
    const notes = plan.categories[0]!.notes.join(" ");
    expect(notes).toContain(
      "Theme, fonts, sidebar layout and keyboard shortcuts",
    );
    expect(notes).toContain("Quit Paseo Telus before syncing");
  });

  it.skipIf(process.platform === "win32")(
    "defers app preferences while Paseo Telus is open",
    async () => {
      const lock = path.join(paths.targetAppDir, "SingletonLock");
      await fsp.symlink(`fakehost-${process.pid}`, lock);
      expect((await detectAppRunning(paths.targetAppDir)).running).toBe(true);

      const plan = await buildPlan(paths, ["desktop"]);
      const desktop = plan.categories[0]!;
      expect(desktop.items[0]?.status).toBe("unavailable");
      expect(desktop.items[0]?.detail).toContain("Paseo Telus is open");
      expect(desktop.notes.join(" ")).toContain("Quit it and sync again");
      expect(plan.operations).toEqual([]);

      const before = await read(
        path.join(paths.targetAppDir, "desktop-settings.json"),
      );
      const result = await executeSync(paths, ["desktop"]);
      expect(result.ok).toBe(true);
      expect(result.copied).toBe(0);
      expect(result.warnings.join(" ")).toContain("Paseo Telus is open");
      expect(
        await read(path.join(paths.targetAppDir, "desktop-settings.json")),
      ).toEqual(before);

      await fsp.rm(lock);
      const after = await buildPlan(paths, ["desktop"]);
      expect(after.categories[0]?.items[0]?.status).toBe("changed");
      expect(after.operations).toHaveLength(1);
    },
  );

  it.skipIf(process.platform === "win32")(
    "treats a lock whose process is gone as stale",
    async () => {
      const pid = await deadProcessPid();
      await fsp.symlink(
        `fakehost-${pid}`,
        path.join(paths.targetAppDir, "SingletonLock"),
      );
      expect((await detectAppRunning(paths.targetAppDir)).running).toBe(false);
    },
  );
});

describe("rollback", () => {
  it.skipIf(process.platform === "win32")(
    "refuses a desktop rollback while Paseo Telus is open",
    async () => {
      const result = await executeSync(paths, ["desktop"]);
      expect(result.ok).toBe(true);
      await fsp.symlink(
        `fakehost-${process.pid}`,
        path.join(paths.targetAppDir, "SingletonLock"),
      );
      const restored = await rollbackSync(paths, result.backupId!);
      expect(restored.ok).toBe(false);
      expect(restored.error).toContain("Paseo Telus is open");
    },
  );

  it("restores the original Telus files and removes what the sync created", async () => {
    const configBefore = await fsp.readFile(
      path.join(paths.targetHome, "config.json"),
      "utf8",
    );
    const backgroundBefore = await fsp.readFile(
      path.join(
        paths.targetHome,
        "plugin-settings/paseo-background/background.json",
      ),
      "utf8",
    );
    const desktopBefore = await fsp.readFile(
      path.join(paths.targetAppDir, "desktop-settings.json"),
      "utf8",
    );
    const result = await executeSync(paths, [
      "ux",
      "desktop",
      "pluginSettings",
    ]);
    expect(result.ok).toBe(true);
    expect(
      await exists(path.join(paths.targetHome, "plugin-settings/tldr")),
    ).toBe(true);

    const restored = await rollbackSync(paths, result.backupId!);
    expect(restored.ok).toBe(true);
    expect(
      await fsp.readFile(path.join(paths.targetHome, "config.json"), "utf8"),
    ).toBe(configBefore);
    expect(
      await fsp.readFile(
        path.join(
          paths.targetHome,
          "plugin-settings/paseo-background/background.json",
        ),
        "utf8",
      ),
    ).toBe(backgroundBefore);
    expect(
      await fsp.readFile(
        path.join(paths.targetAppDir, "desktop-settings.json"),
        "utf8",
      ),
    ).toBe(desktopBefore);
    // Created by the sync, so the rollback removes it.
    expect(
      await exists(path.join(paths.targetHome, "plugin-settings/tldr")),
    ).toBe(false);
    // Untouched by the whole flow.
    expect(
      await fsp.readFile(
        path.join(paths.targetHome, "local-credential"),
        "utf8",
      ),
    ).toBe("telus-secret\n");
    expect(
      await read(
        path.join(paths.targetHome, "plugin-settings/jev-router/router.json"),
      ),
    ).toEqual({
      version: 1,
      values: { enabled: false, apiKey: "telus-own-secret" },
    });

    const history = await listHistory(paths.backupRoot);
    expect(history[0]).toMatchObject({ id: result.backupId, failed: false });
    expect(history[0]?.rolledBackAt).not.toBeNull();
  });
});

describe("history", () => {
  it("keeps the five newest backups and deletes the sixth oldest", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      await write(
        path.join(paths.sourceHome, "config.json"),
        sourceConfig(100 + index),
      );
      const result = await executeSync(
        paths,
        ["ux"],
        new Date(Date.UTC(2026, 0, 1, 12, 0, index)),
      );
      expect(result.ok).toBe(true);
      ids.push(result.backupId!);
    }
    const history = await listHistory(paths.backupRoot);
    expect(history).toHaveLength(MAX_BACKUPS);
    expect(history.map((entry) => entry.id)).toEqual(ids.slice(1).reverse());
    expect(await exists(path.join(paths.backupRoot, ids[0]!))).toBe(false);
    expect(await exists(path.join(paths.backupRoot, ids[5]!))).toBe(true);
  });

  it("refuses to restore a manifest that points at the Telus root", async () => {
    const id = "2026-01-01T00-00-00-000Z";
    const backupDir = path.join(paths.backupRoot, id);
    await fsp.mkdir(backupDir, { recursive: true });
    await write(path.join(backupDir, "manifest.json"), {
      tool: "telus-sync",
      version: 1,
      id,
      at: id,
      sourceHome: paths.sourceHome,
      targetHome: paths.targetHome,
      categories: ["ux"],
      copied: 1,
      same: 0,
      skipped: 0,
      failed: false,
      rolledBackAt: null,
      createdDirs: [],
      warnings: [],
      items: [
        {
          category: "ux",
          label: "config.json",
          target: paths.targetHome,
          backup: null,
          existed: false,
          kind: "dir",
        },
      ],
    });
    const result = await rollbackSync(paths, id);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("root of the Telus install");
    expect(await exists(paths.targetHome)).toBe(true);
  });

  it("rejects an unknown or traversing backup id", async () => {
    const unknown = await rollbackSync(paths, "2099-01-01T00-00-00-000Z");
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toContain("No telus-sync backup");

    const traversal = await rollbackSync(paths, "..");
    expect(traversal.ok).toBe(false);
    expect(traversal.error).toContain("Invalid backup id");
  });
});
