// CUSTOM(warp): exercises custom/plugins/warp and its bridge against a real daemon.
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const pluginDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../custom/plugins/warp",
);
const warpWebDir =
  process.env.PASEO_WARP_WEB_DIR ?? path.join(homedir(), "projetos", "warp-web-custom");
const bridgeInstalled = existsSync(
  path.join(warpWebDir, "paseo-bridge", "node_modules", "node-pty"),
);
const roots: string[] = [];
const originalPaseoHome = process.env.PASEO_HOME;

afterEach(async () => {
  if (originalPaseoHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = originalPaseoHome;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function ptyUrl(pageUrl: string, token: string | null): string {
  const page = new URL(pageUrl);
  const url = new URL("/create", page);
  url.protocol = "ws:";
  if (token) url.searchParams.set("token", token);
  url.searchParams.set("cwd", page.searchParams.get("cwd") ?? "");
  url.searchParams.set("num_rows", "24");
  url.searchParams.set("num_cols", "80");
  return url.toString();
}

/** Runs `command` in a bridge shell and resolves with everything the PTY printed. */
function runInBridge(url: string, command: string, marker: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let output = "";
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`no ${marker} in output: ${JSON.stringify(output.slice(-500))}`));
    }, 15_000);
    ws.on("open", () => ws.send(Buffer.from(`${command}\n`)));
    ws.on("message", (data) => {
      output += data.toString();
      if (!output.includes(marker)) return;
      clearTimeout(timer);
      ws.close();
      resolve(output);
    });
    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function rejected(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.on("open", () => {
      ws.close();
      resolve(false);
    });
    ws.on("error", () => resolve(true));
  });
}

test.skipIf(!bridgeInstalled)(
  "opens a token-protected Warp shell in the workspace directory",
  async () => {
    const workspace = await realpath(await mkdtemp(path.join(tmpdir(), "paseo-warp-")));
    roots.push(workspace);
    const daemon = await createTestPaseoDaemon();
    // The plugin subprocess inherits this; without it the bridge state goes to the real ~/.paseo.
    process.env.PASEO_HOME = daemon.paseoHome;
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.4.0",
    });
    try {
      await client.connect();
      await client.patchDaemonConfig({ pluginsEnabled: true });
      await expect(client.installDirectoryPlugin(pluginDirectory)).resolves.toMatchObject({
        id: "warp",
        status: "running",
      });

      const { url } = (await client.invokePluginRpc("warp", "warp.session.open", {
        cwd: workspace,
      })) as { url: string };
      const page = new URL(url);
      expect(page.hostname).toBe("127.0.0.1");
      expect(page.searchParams.get("cwd")).toBe(workspace);
      const token = page.searchParams.get("token");
      expect(token).toBeTruthy();

      const html = await (await fetch(url)).text();
      expect(html).toContain("PASEO_WARP_PTY_URL");

      await expect(rejected(ptyUrl(url, null))).resolves.toBe(true);
      await expect(rejected(ptyUrl(url, "wrong-token"))).resolves.toBe(true);

      const output = await runInBridge(ptyUrl(url, token), "echo WARP_$((6*7)) $PWD", "WARP_42");
      expect(output).toContain(`WARP_42 ${workspace}`);

      // A second session reuses the same bridge.
      const again = (await client.invokePluginRpc("warp", "warp.session.open", {
        cwd: workspace,
      })) as { url: string };
      expect(new URL(again.url).port).toBe(page.port);
    } finally {
      await client.close().catch(() => undefined);
      await daemon.close();
    }
  },
  60_000,
);
