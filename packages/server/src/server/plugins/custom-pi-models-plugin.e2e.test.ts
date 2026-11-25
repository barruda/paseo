import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PI_MODELS_PLUGIN_ID,
  PI_MODELS_RPC,
  type PiModelsReadOutput,
} from "@getpaseo/protocol/pi-models";
import { afterEach, expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

// CUSTOM(pi-models): the plugin reads and writes Pi's models.json in PI_CODING_AGENT_DIR, refuses a
// save based on a stale revision, and runs `pi` with stdin closed (an open pipe hangs `pi -p`).

const pluginDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../custom/plugins/pi-models",
);
const roots: string[] = [];
const savedEnv = { PATH: process.env.PATH, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };

afterEach(async () => {
  process.env.PATH = savedEnv.PATH;
  if (savedEnv.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedEnv.PI_CODING_AGENT_DIR;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Stands in for pi: echoes its argv, then reads stdin, which only returns when stdin is closed.
const FAKE_PI = `#!/bin/sh
echo "args: $*"
cat > /dev/null
`;

async function start() {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-pi-models-"));
  roots.push(root);
  const bin = path.join(root, "bin");
  const agentDir = path.join(root, "agent");
  await mkdir(bin);
  await writeFile(path.join(bin, "pi"), FAKE_PI);
  await chmod(path.join(bin, "pi"), 0o755);
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const daemon = await createTestPaseoDaemon();
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.4.0" });
  await client.connect();
  await client.patchDaemonConfig({ pluginsEnabled: true });
  await expect(client.installDirectoryPlugin(pluginDirectory)).resolves.toMatchObject({
    id: PI_MODELS_PLUGIN_ID,
  });
  const invoke = (method: string, input: unknown) =>
    client.invokePluginRpc(PI_MODELS_PLUGIN_ID, method, input);
  const close = async () => {
    await client.close();
    await daemon.close();
  };
  return { invoke, close, file: path.join(agentDir, "models.json") };
}

test("creates, saves and guards Pi's models.json", async () => {
  const pi = await start();
  try {
    const empty = (await pi.invoke(PI_MODELS_RPC.read, {})) as PiModelsReadOutput;
    expect(empty).toMatchObject({ path: pi.file, exists: false, text: "" });
    expect(empty.listing).toBe("args: --list-models");

    const text = JSON.stringify({ providers: { local: { baseUrl: "http://x/v1", models: [] } } });
    await expect(
      pi.invoke(PI_MODELS_RPC.write, { text: "{ nope", baseRevision: empty.revision }),
    ).resolves.toMatchObject({ status: "invalid" });
    const saved = (await pi.invoke(PI_MODELS_RPC.write, {
      text,
      baseRevision: empty.revision,
    })) as { status: string; file: PiModelsReadOutput };
    expect(saved).toMatchObject({ status: "saved", file: { exists: true, text: `${text}\n` } });
    expect(await readFile(pi.file, "utf8")).toBe(`${text}\n`);
    expect((await stat(pi.file)).mode & 0o777).toBe(0o600);

    // A save based on the empty file must not overwrite what is there now.
    await expect(
      pi.invoke(PI_MODELS_RPC.write, { text: "{}", baseRevision: empty.revision }),
    ).resolves.toMatchObject({ status: "conflict", file: { text: `${text}\n` } });
    expect(await readFile(pi.file, "utf8")).toBe(`${text}\n`);
  } finally {
    await pi.close();
  }
});

test("tests a model through pi with stdin closed", async () => {
  const pi = await start();
  try {
    await expect(
      pi.invoke(PI_MODELS_RPC.test, { provider: "fuelix", model: "sol", thinking: "high" }),
    ).resolves.toMatchObject({
      ok: true,
      output: "args: --no-session --model fuelix/sol --thinking high -p Reply with exactly: ok",
    });
  } finally {
    await pi.close();
  }
});
