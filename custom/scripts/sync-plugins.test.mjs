import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "sync-plugins.mjs");

function setup({ config, state, plugins }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-plugins-"));
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify(config));
  if (state)
    fs.writeFileSync(path.join(home, "custom-plugins-applied.json"), JSON.stringify(state));
  const manifest = path.join(dir, "plugins.json");
  fs.writeFileSync(manifest, JSON.stringify({ plugins }));
  return { dir, home, manifest };
}

function run(ctx, extra = [], env = {}) {
  const result = spawnSync(
    process.execPath,
    [script, "--home", ctx.home, "--manifest", ctx.manifest, "--root", ctx.dir, ...extra],
    { encoding: "utf8", env: { ...process.env, PASEO_SYNC_DAEMON: "stopped", ...env } },
  );
  const read = (name, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ctx.home, name), "utf8"));
    } catch {
      return fallback;
    }
  };
  return {
    ...result,
    config: read("config.json"),
    state: read("custom-plugins-applied.json", null),
  };
}

const own = { id: "tldr", source: "custom/plugins/tldr" };

test("writes a missing directory plugin and records it", () => {
  const ctx = setup({ config: { pluginsEnabled: true, plugins: {} }, plugins: [own] });
  const r = run(ctx);
  assert.equal(r.status, 0);
  assert.deepEqual(r.config.plugins.tldr, {
    source: "directory",
    path: path.join(ctx.dir, "custom/plugins/tldr"),
    enabled: true,
  });
  assert.deepEqual(r.state, ["tldr"]);
});

test("leaves a disabled entry untouched", () => {
  const entry = { source: "directory", path: "/elsewhere", enabled: false };
  const ctx = setup({ config: { pluginsEnabled: true, plugins: { tldr: entry } }, plugins: [own] });
  const r = run(ctx);
  assert.deepEqual(r.config.plugins.tldr, entry);
  assert.deepEqual(r.state, ["tldr"]);
});

test("does not re-add a plugin the user removed", () => {
  const ctx = setup({
    config: { pluginsEnabled: true, plugins: {} },
    state: ["tldr"],
    plugins: [own],
  });
  const r = run(ctx);
  assert.equal(r.config.plugins.tldr, undefined);
  assert.deepEqual(r.state, ["tldr"]);
});

test("skips warp when its directory is missing and does not record it", () => {
  const warp = {
    id: "warp",
    source: "custom/plugins/warp",
    requiresDir: "~/nope",
    requiresDirEnv: "SYNC_TEST_WARP",
  };
  const ctx = setup({ config: { pluginsEnabled: true, plugins: {} }, plugins: [warp] });
  const missing = path.join(ctx.dir, "no-warp");
  let r = run(ctx, [], { SYNC_TEST_WARP: missing });
  assert.equal(r.config.plugins.warp, undefined);
  assert.deepEqual(r.state, []);
  assert.match(r.stdout, /warp skipped/);
  fs.mkdirSync(missing);
  r = run(ctx, [], { SYNC_TEST_WARP: missing });
  assert.ok(r.config.plugins.warp);
  assert.deepEqual(r.state, ["warp"]);
});

test("turns pluginsEnabled on and says so", () => {
  const ctx = setup({ config: { pluginsEnabled: false, plugins: {} }, plugins: [own] });
  const r = run(ctx);
  assert.equal(r.config.pluginsEnabled, true);
  assert.match(r.stdout, /turning plugins on/);
});

test("warns about a non-directory source when the daemon is stopped", () => {
  const ctx = setup({
    config: { pluginsEnabled: true, plugins: {} },
    plugins: [{ id: "progress", source: "stevecastaneda/progress" }],
  });
  const r = run(ctx);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /WARNING: progress needs the daemon running/);
  assert.equal(r.config.plugins.progress, undefined);
  assert.deepEqual(r.state, []);
});

test("--dry-run writes nothing", () => {
  const ctx = setup({ config: { pluginsEnabled: false, plugins: {} }, plugins: [own] });
  const before = fs.readFileSync(path.join(ctx.home, "config.json"), "utf8");
  const r = run(ctx, ["--dry-run"]);
  assert.equal(fs.readFileSync(path.join(ctx.home, "config.json"), "utf8"), before);
  assert.equal(r.state, null);
  assert.match(r.stdout, /tldr added/);
});
