// CUSTOM(telus-sync): plan, backup, apply, history and rollback. No daemon or agent is touched.
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CATEGORY_IDS,
  CATEGORY_INFO,
  CONFIG_UX_ALLOWLIST,
  DESKTOP_SETTINGS_ALLOWLIST,
  EXCLUDED_PLUGIN_SETTINGS,
  MAX_BACKUPS,
  SKIPPED_SETTINGS_FILE_PATTERN,
  emptyRunResult,
  isCredentialFileName,
  isCredentialKey,
  type CategoryId,
  type HistoryEntry,
  type PreviewCategory,
  type PreviewItem,
  type RunResult,
  type SyncStatus,
} from "../shared/model";

export interface SyncPaths {
  sourceHome: string;
  targetHome: string;
  sourceAppDir: string;
  targetAppDir: string;
  backupRoot: string;
}

type JsonEdit = { path: string[]; value: unknown };

type Operation =
  | {
      kind: "copy-file";
      category: CategoryId;
      label: string;
      source: string;
      target: string;
    }
  | {
      kind: "copy-dir";
      category: CategoryId;
      label: string;
      source: string;
      target: string;
    }
  | {
      kind: "json-edit";
      category: CategoryId;
      label: string;
      target: string;
      edits: JsonEdit[];
    }
  | {
      kind: "merge-json";
      category: CategoryId;
      label: string;
      target: string;
      value: Record<string, unknown>;
    }
  | {
      kind: "write-json";
      category: CategoryId;
      label: string;
      target: string;
      value: unknown;
    };

export interface BuiltPlan {
  categories: PreviewCategory[];
  operations: Operation[];
}

interface ManifestItem {
  category: CategoryId;
  label: string;
  target: string;
  backup: string | null;
  existed: boolean;
  kind: "file" | "dir";
}

interface Manifest {
  tool: "telus-sync";
  version: 1;
  id: string;
  at: string;
  sourceHome: string;
  targetHome: string;
  categories: CategoryId[];
  copied: number;
  same: number;
  skipped: number;
  failed: boolean;
  rolledBackAt: string | null;
  items: ManifestItem[];
  createdDirs: string[];
  warnings: string[];
}

/** The two roots a sync may touch, by the label used inside a backup folder. */
type TargetRoot = "telus-home" | "telus-electron";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandHome(value: string, home = os.homedir()): string {
  return value === "~"
    ? home
    : value.startsWith("~/")
      ? path.join(home, value.slice(2))
      : value;
}

function appDirName(home: string): string {
  const base = path.basename(home);
  return base === ".paseo"
    ? "Paseo"
    : base === ".paseo-telus"
      ? "Paseo-telus"
      : base;
}

function defaultAppDir(home: string): string {
  const name = appDirName(home);
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", name);
  if (process.platform === "win32")
    return path.join(process.env.APPDATA ?? os.homedir(), name);
  return path.join(os.homedir(), ".config", name);
}

/**
 * The Paseo Personal daemon is the only one that syncs: it reads its own home and writes the
 * sibling one. Any other daemon reports why the feature is unavailable.
 */
export function resolveSyncPaths(
  env: NodeJS.ProcessEnv = process.env,
): SyncStatus {
  const sourceHome = path.resolve(expandHome(env.PASEO_HOME ?? "~/.paseo"));
  const targetHome = path.resolve(
    expandHome(env.PASEO_TELUS_HOME ?? "~/.paseo-telus"),
  );
  const sourceAppDir = path.resolve(
    expandHome(env.PASEO_APP_DIR ?? defaultAppDir(sourceHome)),
  );
  const targetAppDir = path.resolve(
    expandHome(env.PASEO_TELUS_APP_DIR ?? defaultAppDir(targetHome)),
  );
  const backupRoot = path.resolve(
    expandHome(
      env.PASEO_TELUS_SYNC_BACKUP_ROOT ?? "~/.paseo-backups/telus-sync",
    ),
  );
  if (path.basename(sourceHome) !== ".paseo") {
    return {
      available: false,
      reason: `This daemon home is ${sourceHome}, not ~/.paseo. The sync runs from Paseo Personal only.`,
      sourceHome,
      targetHome,
      sourceAppDir,
      targetAppDir,
      backupRoot,
    };
  }
  if (sourceHome === targetHome) {
    return {
      available: false,
      reason: "The source and the target are the same home.",
      sourceHome,
      targetHome,
      sourceAppDir,
      targetAppDir,
      backupRoot,
    };
  }
  return {
    available: true,
    reason: null,
    sourceHome,
    targetHome,
    sourceAppDir,
    targetAppDir,
    backupRoot,
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.lstat(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  try {
    await fsp.rename(temp, file);
  } catch {
    // Windows refuses a rename over an existing file.
    await fsp.rm(file, { force: true });
    await fsp.rename(temp, file);
  }
}

function getPath(value: unknown, keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function setPath(
  target: Record<string, unknown>,
  keys: readonly string[],
  value: unknown,
): void {
  let current = target;
  for (const key of keys.slice(0, -1)) {
    const next = current[key];
    if (!isRecord(next)) {
      const created: Record<string, unknown> = {};
      current[key] = created;
      current = created;
    } else {
      current = next;
    }
  }
  current[keys[keys.length - 1]!] = value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]),
  );
}

/** Merges `source` into `target`, keeping target keys the source does not mention. */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (isRecord(current) && isRecord(value)) deepMerge(current, value);
    else target[key] = value;
  }
}

/** Every leaf of `source` has the same value at the same path in `target`. */
function covers(target: unknown, source: unknown): boolean {
  if (isRecord(source)) {
    if (!isRecord(target)) return false;
    return Object.entries(source).every(([key, value]) =>
      covers(target[key], value),
    );
  }
  if (Array.isArray(source)) {
    if (!Array.isArray(target) || target.length !== source.length) return false;
    return source.every((item, index) => covers(target[index], item));
  }
  return target === source;
}

async function fileSignature(file: string): Promise<string> {
  const hash = createHash("sha1");
  hash.update(await fsp.readFile(file));
  return hash.digest("hex");
}

async function dirSignature(dir: string): Promise<string> {
  const hash = createHash("sha1");
  const walk = async (current: string, rel: string): Promise<void> => {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (isSensitiveSourceFile(entry.name)) continue;
      if (entry.isDirectory()) await walk(child, childRel);
      else if (entry.isFile()) {
        hash.update(`${childRel}\0`);
        hash.update(await fileSignature(child));
      }
    }
  };
  await walk(dir, "");
  return hash.digest("hex");
}

async function compareCopy(
  source: string,
  target: string,
  kind: "file" | "dir",
): Promise<PreviewItem["status"]> {
  if (!(await exists(source))) return "unavailable";
  if (!(await exists(target))) return "new";
  const targetIsDir = (await fsp.stat(target)).isDirectory();
  if (kind === "file" ? targetIsDir : !targetIsDir) return "changed";
  const [sourceSignature, targetSignature] = await Promise.all([
    kind === "file" ? fileSignature(source) : dirSignature(source),
    kind === "file" ? fileSignature(target) : dirSignature(target),
  ]);
  return sourceSignature === targetSignature ? "same" : "changed";
}

function rewriteHomePaths(
  value: unknown,
  sourceHome: string,
  targetHome: string,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => rewriteHomePaths(item, sourceHome, targetHome));
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      key === "path" &&
      typeof item === "string" &&
      isInside(sourceHome, item)
    ) {
      next[key] = path.join(targetHome, path.relative(sourceHome, item));
    } else {
      next[key] = rewriteHomePaths(item, sourceHome, targetHome);
    }
  }
  return next;
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Strips `user:token@` from Git remotes and registry URLs before they are copied. */
export function redactUrlCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUrlCredentials);
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && /^https?:\/\//i.test(item)) {
      try {
        const url = new URL(item);
        if (url.username || url.password) {
          url.username = "";
          url.password = "";
          next[key] = url.toString();
          continue;
        }
      } catch {
        // Not a URL; keep it.
      }
    }
    next[key] = redactUrlCredentials(item);
  }
  return next;
}

/** Removes credential keys from a settings document, reporting their dotted paths. */
export function scrubCredentials(
  value: unknown,
  prefix = "",
): { value: unknown; removed: string[] } {
  const removed: string[] = [];
  const walk = (item: unknown, at: string): unknown => {
    if (Array.isArray(item))
      return item.map((child, index) => walk(child, `${at}[${index}]`));
    if (!isRecord(item)) return item;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(item)) {
      const dotted = at ? `${at}.${key}` : key;
      if (isCredentialKey(key)) {
        removed.push(dotted);
        continue;
      }
      next[key] = walk(child, dotted);
    }
    return next;
  };
  return { value: walk(value, prefix), removed };
}

/**
 * Applies the scrubbed source value over the Telus one, restoring credential keys the Telus file
 * already has. Credentials never travel from Personal; replacing the whole block would otherwise
 * delete a credential only the Telus install owns.
 */
function keepTargetCredentials(
  source: unknown,
  target: unknown,
  at: string,
  kept: string[],
): unknown {
  if (Array.isArray(source)) {
    // Index-merge equal-length arrays; a different length means the source replaces the array.
    if (!Array.isArray(target) || target.length !== source.length)
      return source;
    return source.map((item, index) =>
      keepTargetCredentials(item, target[index], `${at}[${index}]`, kept),
    );
  }
  if (!isRecord(source)) return source;
  const targetRecord = isRecord(target) ? target : {};
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    const dotted = at ? `${at}.${key}` : key;
    next[key] = keepTargetCredentials(child, targetRecord[key], dotted, kept);
  }
  for (const [key, child] of Object.entries(targetRecord)) {
    if (Object.hasOwn(next, key)) continue;
    const dotted = at ? `${at}.${key}` : key;
    if (isCredentialKey(key)) {
      next[key] = child;
      kept.push(dotted);
      continue;
    }
    // A branch only the Telus file has: keep it whole, so the credential and the settings it
    // needs stay together. The rest of a branch is still replaced by the source.
    if (hasCredential(child)) {
      next[key] = child;
      collectCredentialPaths(child, dotted, kept);
    }
  }
  return next;
}

/** Whether a settings subtree holds a credential anywhere. */
function hasCredential(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCredential);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => isCredentialKey(key) || hasCredential(child),
  );
}

/** Dotted paths of every credential in a settings subtree. */
function collectCredentialPaths(
  value: unknown,
  at: string,
  kept: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      collectCredentialPaths(child, `${at}[${index}]`, kept),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const dotted = at ? `${at}.${key}` : key;
    if (isCredentialKey(key)) kept.push(dotted);
    else collectCredentialPaths(child, dotted, kept);
  }
}

function categoryStatus(
  items: PreviewItem[],
): Pick<PreviewCategory, "changed" | "same" | "unavailable"> {
  return {
    changed: items.filter(
      (item) => item.status === "new" || item.status === "changed",
    ).length,
    same: items.filter((item) => item.status === "same").length,
    unavailable: items.filter((item) => item.status === "unavailable").length,
  };
}

function makeCategory(
  category: CategoryId,
  items: PreviewItem[],
  notes: string[],
): PreviewCategory {
  return {
    category,
    title: CATEGORY_INFO[category].title,
    description: CATEGORY_INFO[category].description,
    items,
    notes,
    ...categoryStatus(items),
  };
}

async function buildUx(
  paths: SyncPaths,
): Promise<{ category: PreviewCategory; operations: Operation[] }> {
  const sourceFile = path.join(paths.sourceHome, "config.json");
  const targetFile = path.join(paths.targetHome, "config.json");
  const source = await readJson(sourceFile);
  if (!isRecord(source)) {
    return {
      category: makeCategory(
        "ux",
        [
          {
            label: "config.json",
            status: "unavailable",
            detail: "Source config.json is missing or unreadable",
          },
        ],
        [],
      ),
      operations: [],
    };
  }
  const edits: JsonEdit[] = [];
  const labels: string[] = [];
  const kept: string[] = [];
  const target = await readJson(targetFile);
  for (const [top, subkeys] of Object.entries(CONFIG_UX_ALLOWLIST)) {
    const block = source[top];
    if (!isRecord(block)) continue;
    for (const subkey of subkeys) {
      if (!Object.hasOwn(block, subkey)) continue;
      // Speech sites may hold an apiKey; scrub it like any other settings document, then keep
      // the one the Telus file already has so the replacement does not delete it.
      const value = keepTargetCredentials(
        redactUrlCredentials(scrubCredentials(block[subkey]).value),
        getPath(target, [top, subkey]),
        `${top}.${subkey}`,
        kept,
      );
      edits.push({ path: [top, subkey], value });
      labels.push(`${top}.${subkey}`);
    }
  }
  const label = `config.json · ${labels.join(", ") || "no UX keys found"}`;
  let status: PreviewItem["status"] = "changed";
  if (!(await exists(targetFile))) status = "new";
  else
    status = edits.every((edit) =>
      deepEqual(getPath(target, edit.path), edit.value),
    )
      ? "same"
      : "changed";
  return {
    category: makeCategory(
      "ux",
      edits.length
        ? [
            {
              label,
              status,
              detail: kept.length
                ? `Telus credentials kept: ${kept.join(", ")}`
                : null,
            },
          ]
        : [
            {
              label,
              status: "unavailable",
              detail: "config.json has no features block",
            },
          ],
      [
        "Only the config.json features block travels. Providers, MCP servers, env, directories and agent settings stay behind.",
        "Credentials never travel from Personal. A credential only the Telus install has stays there, and the item above lists the ones kept.",
      ],
    ),
    operations: edits.length
      ? [
          {
            kind: "json-edit",
            category: "ux",
            label: "config.json",
            target: targetFile,
            edits,
          },
        ]
      : [],
  };
}

async function buildDesktop(
  paths: SyncPaths,
): Promise<{ category: PreviewCategory; operations: Operation[] }> {
  const sourceFile = path.join(paths.sourceAppDir, "desktop-settings.json");
  const targetFile = path.join(paths.targetAppDir, "desktop-settings.json");
  const source = await readJson(sourceFile);
  if (!isRecord(source) || !isRecord(source.settings)) {
    return {
      category: makeCategory(
        "desktop",
        [
          {
            label: "desktop-settings.json",
            status: "unavailable",
            detail: `No readable desktop settings at ${sourceFile}`,
          },
        ],
        ["The desktop settings are only written by the Electron app."],
      ),
      operations: [],
    };
  }
  const settings = source.settings;
  const edits: JsonEdit[] = [];
  const labels: string[] = [];
  for (const leaf of DESKTOP_SETTINGS_ALLOWLIST) {
    const value = getPath(settings, leaf as string[]);
    if (value === undefined) continue;
    edits.push({ path: ["settings", ...(leaf as string[])], value });
    labels.push(leaf.join("."));
  }
  if (!edits.length) {
    return {
      category: makeCategory(
        "desktop",
        [
          {
            label: "desktop-settings.json",
            status: "unavailable",
            detail: "No allowlisted preference is set in the source file",
          },
        ],
        [],
      ),
      operations: [],
    };
  }
  const target = await readJson(targetFile);
  let status: PreviewItem["status"];
  if (!(await exists(targetFile))) status = "new";
  else
    status = edits.every((edit) =>
      deepEqual(getPath(target, edit.path), edit.value),
    )
      ? "same"
      : "changed";
  return {
    category: makeCategory(
      "desktop",
      [
        {
          label: `desktop-settings.json · ${labels.join(", ")}`,
          status,
          detail: null,
        },
      ],
      [
        "Only notification sounds and flexible tab movement travel. keepRunningAfterQuit, daemon management and the release channel stay as they are.",
        "Theme, fonts, sidebar layout and keyboard shortcuts live in the client's own storage, not here; see the note at the top of this screen.",
      ],
    ),
    operations: edits.length
      ? [
          {
            kind: "json-edit",
            category: "desktop",
            label: "desktop-settings.json",
            target: targetFile,
            edits,
          },
        ]
      : [],
  };
}

/** Top-level folders under plugins/ that hold a configured, source-managed plugin. */
function managedPluginDirs(
  source: Record<string, unknown>,
  sourceHome: string,
): string[] {
  const plugins = source.plugins;
  if (!isRecord(plugins)) return [];
  const root = path.join(sourceHome, "plugins");
  const dirs = new Set<string>();
  for (const entry of Object.values(plugins)) {
    if (!isRecord(entry) || typeof entry.path !== "string") continue;
    if (!isInside(root, entry.path)) continue;
    const top = path.relative(root, entry.path).split(path.sep)[0];
    if (top && top !== ".staging") dirs.add(top);
  }
  return [...dirs].sort();
}

async function buildPlugins(
  paths: SyncPaths,
): Promise<{ category: PreviewCategory; operations: Operation[] }> {
  const sourceFile = path.join(paths.sourceHome, "config.json");
  const targetFile = path.join(paths.targetHome, "config.json");
  const source = await readJson(sourceFile);
  if (!isRecord(source)) {
    return {
      category: makeCategory(
        "plugins",
        [
          {
            label: "config.json",
            status: "unavailable",
            detail: "Source config.json is missing or unreadable",
          },
        ],
        [],
      ),
      operations: [],
    };
  }
  const items: PreviewItem[] = [];
  const operations: Operation[] = [];
  const notes: string[] = [];
  if (isRecord(source.plugins)) {
    const plugins = rewriteHomePaths(
      source.plugins,
      paths.sourceHome,
      paths.targetHome,
    ) as Record<string, unknown>;
    const edits: JsonEdit[] = [
      { path: ["pluginsEnabled"], value: source.pluginsEnabled === true },
      { path: ["plugins"], value: plugins },
    ];
    const target = await readJson(targetFile);
    const status: PreviewItem["status"] = !(await exists(targetFile))
      ? "new"
      : edits.every((edit) => deepEqual(getPath(target, edit.path), edit.value))
        ? "same"
        : "changed";
    items.push({
      label: `config.json · pluginsEnabled and plugins (${Object.keys(plugins).length} plugins)`,
      status,
      detail: null,
    });
    operations.push({
      kind: "json-edit",
      category: "plugins",
      label: "config.json",
      target: targetFile,
      edits,
    });
  } else {
    items.push({
      label: "config.json · plugins",
      status: "unavailable",
      detail: "No plugins are configured",
    });
  }
  const appliedSource = path.join(
    paths.sourceHome,
    "custom-plugins-applied.json",
  );
  const appliedTarget = path.join(
    paths.targetHome,
    "custom-plugins-applied.json",
  );
  const appliedStatus = await compareCopy(appliedSource, appliedTarget, "file");
  items.push({
    label: "custom-plugins-applied.json",
    status: appliedStatus,
    detail: appliedStatus === "unavailable" ? "Not present in this home" : null,
  });
  if (appliedStatus !== "unavailable")
    operations.push({
      kind: "copy-file",
      category: "plugins",
      label: "custom-plugins-applied.json",
      source: appliedSource,
      target: appliedTarget,
    });
  const sourcesFile = path.join(paths.sourceHome, "plugins", "sources.json");
  const sourcesTarget = path.join(paths.targetHome, "plugins", "sources.json");
  const rawSources = await readJson(sourcesFile);
  if (rawSources === undefined) {
    items.push({
      label: "plugins/sources.json",
      status: "unavailable",
      detail: "No managed plugin sources",
    });
  } else {
    // A Git remote may embed user:token; never copy that.
    const sources = redactUrlCredentials(rawSources);
    const existingSources = await readJson(sourcesTarget);
    const sourcesStatus: PreviewItem["status"] = !(await exists(sourcesTarget))
      ? "new"
      : deepEqual(existingSources, sources)
        ? "same"
        : "changed";
    items.push({
      label: "plugins/sources.json",
      status: sourcesStatus,
      detail: null,
    });
    operations.push({
      kind: "write-json",
      category: "plugins",
      label: "plugins/sources.json",
      target: sourcesTarget,
      value: sources,
    });
  }
  for (const dir of managedPluginDirs(source, paths.sourceHome)) {
    const sourceDir = path.join(paths.sourceHome, "plugins", dir);
    const targetDir = path.join(paths.targetHome, "plugins", dir);
    const status = await compareCopy(sourceDir, targetDir, "dir");
    items.push({ label: `plugins/${dir}/`, status, detail: null });
    if (status !== "unavailable")
      operations.push({
        kind: "copy-dir",
        category: "plugins",
        label: `plugins/${dir}/`,
        source: sourceDir,
        target: targetDir,
      });
  }
  notes.push(
    "Plugins installed from a repo folder are configured by path, and both homes already share that folder, so their source is not copied.",
    "plugin-data/ (boards, history, caches) is execution data and never travels.",
  );
  return { category: makeCategory("plugins", items, notes), operations };
}

async function buildPluginSettings(
  paths: SyncPaths,
): Promise<{ category: PreviewCategory; operations: Operation[] }> {
  const root = path.join(paths.sourceHome, "plugin-settings");
  const items: PreviewItem[] = [];
  const operations: Operation[] = [];
  const notes: string[] = [];
  if (!(await exists(root))) {
    return {
      category: makeCategory(
        "pluginSettings",
        [],
        ["No plugin-settings folder in this home."],
      ),
      operations,
    };
  }
  const dirs = (await fsp.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const dir of dirs) {
    const excluded = EXCLUDED_PLUGIN_SETTINGS[dir.name];
    if (excluded) {
      notes.push(`Skipped ${dir.name}: ${excluded}.`);
      continue;
    }
    const pluginDir = path.join(root, dir.name);
    const files = await listFiles(pluginDir);
    for (const file of files) {
      const rel = path.relative(paths.sourceHome, file);
      const target = path.join(paths.targetHome, rel);
      if (SKIPPED_SETTINGS_FILE_PATTERN.test(path.basename(file))) {
        notes.push(`Skipped ${rel}: local backup file.`);
        continue;
      }
      if (isCredentialFileName(path.basename(file))) {
        notes.push(`Skipped ${rel}: the file name looks like a credential.`);
        continue;
      }
      if (path.extname(file) !== ".json") {
        notes.push(
          `Skipped ${rel}: not JSON, so credentials cannot be checked.`,
        );
        continue;
      }
      const raw = await readJson(file);
      if (raw === undefined) {
        notes.push(`Skipped ${rel}: unreadable JSON.`);
        continue;
      }
      const scrubbed = scrubCredentials(raw);
      const value = redactUrlCredentials(scrubbed.value);
      const { removed } = scrubbed;
      if (!isRecord(value)) {
        items.push({
          label: rel,
          status: "unavailable",
          detail: "The settings file is not a JSON object",
        });
        notes.push(`Skipped ${rel}: the settings file is not an object.`);
        continue;
      }
      const detail = removed.length
        ? `credentials removed: ${removed.join(", ")}`
        : null;
      const existing = await readJson(target);
      const status: PreviewItem["status"] = !(await exists(target))
        ? "new"
        : covers(existing, value)
          ? "same"
          : "changed";
      items.push({ label: rel, status, detail });
      operations.push({
        kind: "merge-json",
        category: "pluginSettings",
        label: rel,
        target,
        value,
      });
    }
  }
  notes.push(
    "Credential keys are dropped from every file, and the local settings file keeps any credential the Telus install already has.",
    "plugin-data/ (boards, images, history) is execution data and never travels.",
  );
  if (!items.length)
    notes.unshift(
      "No plugin settings were left to copy: none exist here, or all belong to the exclusion list.",
    );
  return { category: makeCategory("pluginSettings", items, notes), operations };
}

async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (current: string): Promise<void> => {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  await walk(dir);
  return files;
}

/** Two operations on the same file are folded into one so the file is written once. */
function mergeOperations(operations: Operation[]): Operation[] {
  const merged: Operation[] = [];
  const byTarget = new Map<string, number>();
  for (const operation of operations) {
    if (operation.kind !== "json-edit") {
      merged.push(operation);
      continue;
    }
    const index = byTarget.get(operation.target);
    const existing = index === undefined ? undefined : merged[index];
    if (index !== undefined && existing?.kind === "json-edit") {
      merged[index] = {
        ...existing,
        label: `${existing.label.split(" · ")[0]} · combined`,
        edits: [...existing.edits, ...operation.edits],
      };
    } else {
      byTarget.set(operation.target, merged.length);
      merged.push({ ...operation });
    }
  }
  return merged;
}

export async function buildPlan(
  paths: SyncPaths,
  categories: CategoryId[],
): Promise<BuiltPlan> {
  const builders = {
    ux: buildUx,
    desktop: buildDesktop,
    plugins: buildPlugins,
    pluginSettings: buildPluginSettings,
  };
  const results = await Promise.all(
    categories.map((category) => builders[category](paths)),
  );
  return {
    categories: results.map((result) => result.category),
    operations: mergeOperations(results.flatMap((result) => result.operations)),
  };
}

function makeId(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function targetRoot(
  paths: SyncPaths,
  target: string,
): { root: TargetRoot; rel: string } {
  for (const [root, dir] of [
    ["telus-home", paths.targetHome],
    ["telus-electron", paths.targetAppDir],
  ] as const) {
    if (!isInside(dir, target)) continue;
    const rel = path.relative(dir, target);
    if (!rel)
      throw new Error(
        `Refusing to sync the root of the Telus install: ${target}`,
      );
    return { root, rel };
  }
  throw new Error(
    `Refusing to sync a path outside the Telus install: ${target}`,
  );
}

async function ensureDirTracked(dir: string, created: string[]): Promise<void> {
  const missing: string[] = [];
  let current = dir;
  while (!(await exists(current))) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!missing.length) return;
  await fsp.mkdir(dir, { recursive: true });
  for (const item of missing.reverse()) created.push(item);
}

async function copyPath(source: string, target: string): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.cp(source, target, {
    recursive: true,
    preserveTimestamps: true,
    force: true,
  });
}

/**
 * Files a managed plugin source may not carry into the other home: VCS data, npm credentials and
 * dotenv files. Kept narrow so real assets (`tokenizer.json`) still copy.
 */
function isSensitiveSourceFile(base: string): boolean {
  return (
    base === ".git" ||
    base === ".npmrc" ||
    /^\.env(\..*)?$/i.test(base) ||
    /^(credentials?|secrets?|tokens?)(\..*)?$/i.test(base) ||
    /\.(pem|key)$/i.test(base)
  );
}

/** Copies a managed plugin folder without VCS data or npm credentials. */
async function copySourceTree(source: string, target: string): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  // The old tree is already backed up, so replace it instead of merging: files the source no
  // longer has would otherwise survive and keep the preview "changed" forever.
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.cp(source, target, {
    recursive: true,
    force: true,
    filter: (candidate) => !isSensitiveSourceFile(path.basename(candidate)),
  });
}

export async function executeSync(
  paths: SyncPaths,
  categories: CategoryId[],
  now = new Date(),
): Promise<RunResult> {
  const ordered = CATEGORY_IDS.filter((id) => categories.includes(id));
  if (!ordered.length)
    return emptyRunResult({ error: "Select at least one category." });
  const plan = await buildPlan(paths, ordered);
  const changes = plan.categories.reduce(
    (total, category) => total + category.changed,
    0,
  );
  const same = plan.categories.reduce(
    (total, category) => total + category.same,
    0,
  );
  const unavailable = plan.categories.reduce(
    (total, category) => total + category.unavailable,
    0,
  );
  const warnings = plan.categories.flatMap((category) =>
    category.items
      .filter((item) => item.status === "unavailable")
      .map(
        (item) =>
          `${category.title}: ${item.label} — ${item.detail ?? "unavailable"}`,
      ),
  );
  if (!changes) {
    return emptyRunResult({
      ok: true,
      copied: 0,
      same,
      skipped: unavailable,
      warnings,
      apply: applyNotes(ordered),
    });
  }
  await fsp.mkdir(paths.backupRoot, { recursive: true });
  let id = makeId(now);
  for (
    let suffix = 1;
    await exists(path.join(paths.backupRoot, id));
    suffix += 1
  )
    id = `${makeId(now)}-${suffix}`;
  const backupDir = path.join(paths.backupRoot, id);
  const createdDirs: string[] = [];
  const manifest: Manifest = {
    tool: "telus-sync",
    version: 1,
    id,
    at: now.toISOString(),
    sourceHome: paths.sourceHome,
    targetHome: paths.targetHome,
    categories: ordered,
    copied: 0,
    same,
    skipped: unavailable,
    failed: false,
    rolledBackAt: null,
    items: [],
    createdDirs,
    warnings,
  };
  try {
    for (const operation of plan.operations) {
      const { root, rel } = targetRoot(paths, operation.target);
      const existed = await exists(operation.target);
      const isDir = existed
        ? (await fsp.stat(operation.target)).isDirectory()
        : operation.kind === "copy-dir";
      const backupRel = existed
        ? path.posix.join("files", root, rel.split(path.sep).join("/"))
        : null;
      if (existed && backupRel)
        await copyPath(operation.target, path.join(backupDir, backupRel));
      manifest.items.push({
        category: operation.category,
        label: operation.label,
        target: operation.target,
        backup: backupRel,
        existed,
        kind: isDir ? "dir" : "file",
      });
    }
    await writeJson(path.join(backupDir, "manifest.json"), manifest);
    for (const operation of plan.operations) {
      await ensureDirTracked(path.dirname(operation.target), createdDirs);
      const existed = await exists(operation.target);
      if (operation.kind === "copy-file") {
        await fsp.copyFile(operation.source, operation.target);
      } else if (operation.kind === "copy-dir") {
        await copySourceTree(operation.source, operation.target);
      } else if (operation.kind === "write-json") {
        await writeJson(operation.target, operation.value);
      } else {
        const current = await readJson(operation.target);
        if (existed && !isRecord(current))
          throw new Error(
            `Refusing to overwrite ${operation.target}: it is not a JSON object.`,
          );
        const next = isRecord(current) ? { ...current } : {};
        if (operation.kind === "json-edit") {
          for (const edit of operation.edits)
            setPath(next, edit.path, edit.value);
        } else {
          deepMerge(next, operation.value);
        }
        await writeJson(operation.target, next);
      }
    }
    manifest.copied = changes;
    manifest.createdDirs = [...new Set(createdDirs)];
    await writeJson(path.join(backupDir, "manifest.json"), manifest);
    await pruneBackups(paths.backupRoot).catch(() => undefined);
    return {
      ok: true,
      backupId: id,
      backupPath: backupDir,
      copied: changes,
      same,
      skipped: unavailable,
      warnings,
      apply: applyNotes(ordered),
      error: null,
    };
  } catch (error) {
    manifest.failed = true;
    await writeJson(path.join(backupDir, "manifest.json"), manifest).catch(
      () => undefined,
    );
    await pruneBackups(paths.backupRoot).catch(() => undefined);
    return emptyRunResult({
      backupId: id,
      backupPath: backupDir,
      copied: 0,
      same,
      skipped: unavailable,
      warnings,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function applyNotes(categories: CategoryId[]): string[] {
  const notes: string[] = [];
  if (categories.includes("desktop"))
    notes.push("Reopen the Paseo Telus window to load the app preferences.");
  if (categories.includes("ux"))
    notes.push(
      "Restart the Paseo Telus daemon (Settings > Restart daemon) to apply the daemon UX configuration. The sync does not restart it.",
    );
  if (categories.includes("plugins"))
    notes.push(
      "Restart the Paseo Telus daemon so it reads the new plugin list and sources. The sync does not restart it.",
    );
  if (categories.includes("pluginSettings"))
    notes.push(
      "Run `paseo plugin reload <id> --home ~/.paseo-telus` for each changed plugin. The sync does not reload or restart anything.",
    );
  return notes;
}

async function pruneBackups(backupRoot: string): Promise<void> {
  const entries = (await fsp.readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  let kept = 0;
  for (const entry of entries) {
    const manifest = (await readJson(
      path.join(backupRoot, entry, "manifest.json"),
    )) as Partial<Manifest> | undefined;
    if (manifest?.tool !== "telus-sync") continue;
    if (kept < MAX_BACKUPS) {
      kept += 1;
    } else {
      await fsp.rm(path.join(backupRoot, entry), {
        recursive: true,
        force: true,
      });
    }
  }
}

export async function listHistory(backupRoot: string): Promise<HistoryEntry[]> {
  if (!(await exists(backupRoot))) return [];
  const entries = (await fsp.readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const history: HistoryEntry[] = [];
  for (const entry of entries) {
    const manifest = (await readJson(
      path.join(backupRoot, entry, "manifest.json"),
    )) as Partial<Manifest> | undefined;
    if (manifest?.tool !== "telus-sync") continue;
    history.push({
      id: entry,
      at: manifest.at ?? entry,
      categories: (manifest.categories ?? []).filter((category) =>
        (CATEGORY_IDS as readonly string[]).includes(category),
      ) as CategoryId[],
      copied: manifest.copied ?? 0,
      same: manifest.same ?? 0,
      skipped: manifest.skipped ?? 0,
      failed: manifest.failed === true,
      rolledBackAt: manifest.rolledBackAt ?? null,
    });
    if (history.length >= MAX_BACKUPS) break;
  }
  return history;
}

export async function rollbackSync(
  paths: SyncPaths,
  backupId: string,
): Promise<RunResult> {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-\d+)?$/.test(backupId))
    return emptyRunResult({ error: "Invalid backup id." });
  const backupDir = path.join(paths.backupRoot, backupId);
  const manifest = (await readJson(path.join(backupDir, "manifest.json"))) as
    | Partial<Manifest>
    | undefined;
  if (manifest?.tool !== "telus-sync" || !Array.isArray(manifest.items))
    return emptyRunResult({ error: `No telus-sync backup named ${backupId}.` });
  const items = manifest.items as ManifestItem[];
  const createdDirs = Array.isArray(manifest.createdDirs)
    ? (manifest.createdDirs as string[])
    : [];
  let restored = 0;
  try {
    const filesRoot = path.join(backupDir, "files");
    for (const item of items) {
      targetRoot(paths, item.target);
      if (item.backup) {
        const backupFile = path.resolve(backupDir, item.backup);
        if (
          !isInside(filesRoot, backupFile) ||
          backupFile === filesRoot ||
          !(await exists(backupFile))
        )
          throw new Error(`The backup is missing ${item.backup}.`);
        if (item.kind === "dir")
          await fsp.rm(item.target, { recursive: true, force: true });
        await copyPath(backupFile, item.target);
        restored += 1;
      } else {
        await fsp.rm(item.target, { recursive: true, force: true });
      }
    }
    for (const dir of createdDirs) targetRoot(paths, dir);
    for (const dir of [...createdDirs].sort(
      (left, right) => right.length - left.length,
    )) {
      await fsp.rmdir(dir).catch(() => undefined);
    }
    const updated: Manifest = {
      ...(manifest as Manifest),
      rolledBackAt: new Date().toISOString(),
    };
    await writeJson(path.join(backupDir, "manifest.json"), updated);
    const categories = (manifest.categories ?? []).filter((category) =>
      (CATEGORY_IDS as readonly string[]).includes(category),
    ) as CategoryId[];
    return {
      ok: true,
      backupId,
      backupPath: backupDir,
      copied: restored,
      same: 0,
      skipped: 0,
      warnings: [],
      apply: applyNotes(categories),
      error: null,
    };
  } catch (error) {
    return emptyRunResult({
      backupId,
      backupPath: backupDir,
      copied: restored,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
