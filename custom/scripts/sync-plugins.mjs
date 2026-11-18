#!/usr/bin/env node
// Installs the plugins listed in custom/plugins.json on one daemon home.
// Usage: node custom/scripts/sync-plugins.mjs --home <home> [--dry-run]
// Test hooks: --manifest <file>, --root <dir>, PASEO_SYNC_DAEMON=running|stopped (skips `plugin ls`).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--home") args.home = argv[++i];
    else if (arg === "--manifest") args.manifest = argv[++i];
    else if (arg === "--root") args.root = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.home) throw new Error("--home <home> is required");
  return args;
}

function expandHome(p) {
  return p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p;
}

function isDirectorySource(source) {
  return (
    !/^(npm:|github:|git:|https?:|ssh:|git@)/.test(source) && /^(\.|\/|~|custom\/)/.test(source)
  );
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

// Entries that are absent from config and the state file and whose required directory exists.
function selectPending(manifest, configured, applied, label) {
  const todo = [];
  for (const entry of manifest) {
    if (configured(entry.id)) {
      applied.add(entry.id);
      continue;
    }
    if (applied.has(entry.id)) continue;
    if (entry.requiresDir) {
      const required = expandHome(
        (entry.requiresDirEnv && process.env[entry.requiresDirEnv]) || entry.requiresDir,
      );
      if (!fs.existsSync(required)) {
        console.log(
          `${label} ${entry.id} skipped: ${required} does not exist (installed on a later run)`,
        );
        continue;
      }
    }
    todo.push(entry);
  }
  return todo;
}

function installViaCli(entry, source, runCli, warn) {
  const cliArgs = ["plugin", "install", source, "--id", entry.id];
  if (entry.ref) cliArgs.push("--ref", entry.ref);
  const result = runCli(cliArgs);
  if (result.status === 0) return true;
  const detail = (result.stderr || result.stdout || "").trim().split("\n").pop();
  warn(`installing ${entry.id} failed: ${detail}`);
  return false;
}

// A stopped daemon reads its plugin sources from config.json when it starts.
function addToConfig(configFile, id, dir) {
  const fresh = readJson(configFile);
  fresh.plugins = { ...fresh.plugins, [id]: { source: "directory", path: dir, enabled: true } };
  writeJson(configFile, fresh);
  return true;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root ?? path.join(scriptDir, "..", ".."));
  const manifest = readJson(args.manifest ?? path.join(root, "custom", "plugins.json")).plugins;
  const home = path.resolve(expandHome(args.home));
  const configFile = path.join(home, "config.json");
  const stateFile = path.join(home, "custom-plugins-applied.json");
  const label = `  ${home}:`;
  const cli = ["npx", "tsx", "packages/cli/src/index.js"];

  const runCli = (cliArgs) =>
    spawnSync(cli[0], [...cli.slice(1), ...cliArgs, "--home", home], {
      cwd: root,
      encoding: "utf8",
    });

  const config = readJson(configFile);
  const applied = new Set(readJson(stateFile, []));
  const configured = (id) => Object.hasOwn(readJson(configFile).plugins ?? {}, id);
  const dry = args.dryRun ? " (dry run)" : "";

  let running;
  if (process.env.PASEO_SYNC_DAEMON) running = process.env.PASEO_SYNC_DAEMON === "running";
  else running = runCli(["plugin", "ls"]).status === 0;

  const todo = selectPending(manifest, configured, applied, label);

  const warn = (message) => {
    console.log(`${label} WARNING: ${message}`);
  };

  if (todo.length > 0 && config.pluginsEnabled !== true) {
    console.log(`${label} turning plugins on${dry}`);
    if (!args.dryRun) {
      const fresh = readJson(configFile);
      fresh.pluginsEnabled = true;
      writeJson(configFile, fresh);
      if (running) {
        const reload = runCli(["reload"]);
        if (reload.status !== 0) warn("paseo reload failed; reload the daemon to turn plugins on");
      }
    }
  }

  for (const entry of todo) {
    const dir = isDirectorySource(entry.source)
      ? path.resolve(root, expandHome(entry.source))
      : null;
    if (!running && !dir) {
      warn(
        `${entry.id} needs the daemon running to install ${entry.source}; run the update again with it running`,
      );
      continue;
    }
    console.log(
      running
        ? `${label} installing ${entry.id} from ${entry.source}${dry}`
        : `${label} ${entry.id} added from ${entry.source}; it starts with the daemon${dry}`,
    );
    if (args.dryRun) continue;
    const ok = running
      ? installViaCli(entry, dir ?? entry.source, runCli, warn)
      : addToConfig(configFile, entry.id, dir);
    if (ok) applied.add(entry.id);
  }

  if (!args.dryRun) writeJson(stateFile, [...applied].sort());
}

try {
  main();
} catch (error) {
  console.error(`sync-plugins: ${error.message}`);
  process.exit(1);
}
