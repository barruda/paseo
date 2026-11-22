// CUSTOM(factory): shadow mode (docs/factory.md, ticket 7). Watches the factory folder, loads and
// compiles it 500 ms after the last change, and diffs it against the live config. It applies
// nothing: the board keeps reading workboard-data.json. An invalid factory keeps the last valid
// compile for the diff and reports its errors.
import { watch as watchDir, type FSWatcher } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  compileFactory,
  type CompiledFactory,
} from "../../shared/factory/compile";
import { diffFactory, type LiveIds } from "../../shared/factory/diff";
import type { FactoryIssue } from "../../shared/factory/schema";
import {
  FACTORY_DIFFERENCE_LIMIT,
  formatFactoryIssue,
  type FactoryDifference,
  type FactoryMode,
  type FactorySettings,
  type FactoryStatus,
  type FactorySummary,
} from "../../shared/factory/status";
import { factoryIdSchema } from "../../shared/factory/schema";
import type { Data } from "../../shared/model";
import { ASSISTANT_PROFILE } from "../../shared/profiles";
import { IDS_FILE, slugger } from "./export";
import { loadFactory } from "./loader";
import { factoryRevision } from "./revision";

export const FACTORY_DEBOUNCE_MS = 500;
/** While the folder is missing, look for it again this often. */
const MISSING_RETRY_MS = 30_000;
/** Folders below a watched one; `workers/<id>/skills/<name>/` is the deepest the loader reads. */
const MAX_DEPTH = 4;
const ACTIVE_NOTE =
  "Active mode is not built yet (ticket 9): the factory runs in shadow mode, nothing is applied";

export type Unwatch = () => void;
/** Calls `changed` on any change of the folder's direct entries. */
export type WatchFolder = (dir: string, changed: () => void) => Unwatch;

/** What the shadow reads of the board; null while the board is down. */
export type ShadowLive = {
  /** Cheap reads, done on every summary. */
  settings: () => FactorySettings;
  /** Changes with every saved change of the data. */
  revision: () => number;
  /** The whole data, read only when the diff is computed again. */
  data: () => Data;
  projects: () => ReadonlyArray<{ id: string; directory: string }>;
};

export type FactoryShadowOptions = {
  live: () => ShadowLive | null;
  /** The folder an empty `root` setting means (`$PASEO_HOME/factory`). */
  defaultRoot: string;
  /** `<PASEO_HOME>/plugin-data/power-workboard/profiles`, read for the prompts. */
  profilesRoot: string;
  homeDir?: string;
  debounceMs?: number;
  watch?: WatchFolder;
  load?: typeof loadFactory;
  revision?: (root: string) => Promise<string | null>;
  now?: () => number;
};

const idsFileSchema = z.object({
  workers: z.record(z.string(), z.string()).default({}),
  pools: z.record(z.string(), z.string()).default({}),
});

export const watchFolder: WatchFolder = (dir, changed) => {
  let watcher: FSWatcher;
  try {
    watcher = watchDir(dir, { persistent: false }, () => changed());
  } catch {
    return () => undefined;
  }
  // A removed folder errors on some platforms; the next reload watches what exists then.
  watcher.on("error", () => changed());
  return () => watcher.close();
};

/** The folders the loader reads (no `memory/`, no dot folders except `.git` at the root). */
async function factoryFolders(root: string): Promise<string[]> {
  const folders = [root];
  const visit = async (dir: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (dir === root && entry.name === ".git") {
        // Commits change the revision, not the content: the index file is enough.
        folders.push(full);
        continue;
      }
      if (entry.name.startsWith(".") || entry.name === "memory") continue;
      folders.push(full);
      await visit(full, depth + 1);
    }
  };
  await visit(root, 1);
  return folders;
}

/** `<PASEO_HOME>/factory`, next to the plugin data. */
export function defaultFactoryRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.PASEO_HOME || "~/.paseo";
  const home = raw.startsWith("~") ? path.join(homedir(), raw.slice(1)) : raw;
  return path.join(path.resolve(home), "factory");
}

export function resolveFactoryRoot(
  setting: string,
  defaultRoot: string,
  home: string,
): string {
  const value = setting.trim();
  if (!value) return path.resolve(defaultRoot);
  if (value === "~") return home;
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  return path.resolve(value);
}

/** The export's ids when `.factory-ids.json` is missing: slugs of names, `-2` on repeats. */
function idsByName(data: Data): LiveIds {
  const workerSlug = slugger();
  const poolSlug = slugger();
  const ids: LiveIds = { workers: {}, pools: {} };
  for (const pool of data.settings.pools)
    ids.pools[pool.id] = factoryIdSchema.safeParse(pool.id).success
      ? poolSlug(pool.id, "pool")
      : poolSlug(pool.name, "pool");
  for (const orchestrator of data.orchestrators)
    ids.workers[orchestrator.id] = workerSlug(orchestrator.name, "worker");
  return ids;
}

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

type Target = { mode: FactoryMode; root: string };

export class FactoryShadow {
  private target: Target = { mode: "off", root: "" };
  private watchers = new Map<string, Unwatch>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  /** Bumped on every reconfigure and dispose; a load of an older one is dropped. */
  private generation = 0;
  private running: Promise<void> | null = null;
  private again = false;
  private disposed = false;

  private projectsKey = "";
  private errors: FactoryIssue[] = [];
  private warnings: FactoryIssue[] = [];
  private compiled: CompiledFactory | null = null;
  private fileIds: LiveIds | null = null;
  private revision: string | null = null;
  private loadedAt: string | null = null;
  private differences: FactoryDifference[] | null = null;
  /** The live data revision the differences were computed against. */
  private diffRevision: number | null = null;
  private diffing: Promise<void> | null = null;

  private readonly home: string;
  private readonly debounceMs: number;
  private readonly watch: WatchFolder;
  private readonly load: typeof loadFactory;
  private readonly revisionOf: (root: string) => Promise<string | null>;
  private readonly now: () => number;

  constructor(private options: FactoryShadowOptions) {
    this.home = options.homeDir ?? homedir();
    this.debounceMs = options.debounceMs ?? FACTORY_DEBOUNCE_MS;
    this.watch = options.watch ?? watchFolder;
    this.load = options.load ?? loadFactory;
    this.revisionOf = options.revision ?? factoryRevision;
    this.now = options.now ?? Date.now;
  }

  /**
   * Follows the setting and the board's projects: a new mode or folder starts over, new projects
   * compile again, and a new data revision computes the diff again. Cheap; called on every read.
   */
  sync(): void {
    if (this.disposed) return;
    const live = this.options.live();
    if (!live) return;
    const settings = live.settings();
    const target: Target =
      settings.mode === "off"
        ? { mode: "off", root: "" }
        : {
            mode: settings.mode,
            root: resolveFactoryRoot(
              settings.root,
              this.options.defaultRoot,
              this.home,
            ),
          };
    if (target.mode !== this.target.mode || target.root !== this.target.root) {
      this.restart(target);
      if (target.mode === "off") return;
      this.projectsKey = projectsKeyOf(live.projects());
      this.schedule(0);
      return;
    }
    if (target.mode === "off") return;
    const projectsKey = projectsKeyOf(live.projects());
    if (projectsKey !== this.projectsKey) {
      this.projectsKey = projectsKey;
      this.schedule(this.debounceMs);
    } else if (
      this.compiled &&
      !this.diffing &&
      this.diffRevision !== live.revision()
    )
      void this.refreshDiff().catch(() => undefined);
  }

  summary(): FactorySummary | null {
    this.sync();
    if (this.target.mode === "off") return null;
    return {
      mode: this.target.mode,
      loading: this.loading,
      errors: this.errors.length,
      firstError: this.errors[0] ? formatFactoryIssue(this.errors[0]) : null,
      differences: this.differences ? this.differences.length : null,
      note: this.note,
    };
  }

  /**
   * The full status. A load waiting for its debounce runs now and is awaited, and the diff runs
   * again so prompt edits show.
   */
  async status(): Promise<FactoryStatus> {
    this.sync();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.run();
    }
    while (this.running) await this.running;
    if (this.compiled) await this.refreshDiff();
    const differences = this.differences ?? [];
    return {
      mode: this.target.mode,
      root: this.target.root,
      loading: this.loading,
      loadedAt: this.loadedAt,
      revision: this.revision,
      errors: this.errors,
      warnings: this.warnings,
      compiled: this.compiled !== null,
      differences: differences.slice(0, FACTORY_DIFFERENCE_LIMIT),
      differenceCount: differences.length,
      note: this.note,
    };
  }

  /** Resolves once no load or diff is running; a debounced load still waiting is not awaited. */
  async idle(): Promise<void> {
    while (this.running || this.diffing) {
      await this.running;
      await this.diffing;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.restart({ mode: "off", root: "" });
  }

  private get loading(): boolean {
    return this.timer !== undefined || this.running !== null;
  }

  private get note(): string | null {
    return this.target.mode === "active" ? ACTIVE_NOTE : null;
  }

  private restart(target: Target) {
    this.generation++;
    this.target = target;
    clearTimeout(this.timer);
    clearTimeout(this.retry);
    this.timer = undefined;
    this.retry = undefined;
    for (const unwatch of this.watchers.values()) unwatch();
    this.watchers.clear();
    this.errors = [];
    this.warnings = [];
    this.compiled = null;
    this.fileIds = null;
    this.revision = null;
    this.loadedAt = null;
    this.differences = null;
    this.diffRevision = null;
    this.again = false;
  }

  /** Trailing debounce: every change pushes the load back. */
  private schedule(delay: number) {
    if (this.target.mode === "off" || this.disposed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.run();
    }, delay);
  }

  private run() {
    if (this.running) {
      this.again = true;
      return;
    }
    const generation = this.generation;
    this.running = this.reload(generation)
      .catch((error) => {
        if (generation !== this.generation) return;
        this.errors = [
          {
            kind: "parse",
            file: ".",
            line: null,
            message: error instanceof Error ? error.message : String(error),
          },
        ];
      })
      .finally(() => {
        this.running = null;
        // A change that came in meanwhile loads now, even when it is a new folder or mode (a new
        // generation): `run` reads the current target. `restart` clears `again` for off.
        if (this.again && !this.disposed && this.target.mode !== "off") {
          this.again = false;
          this.run();
        }
      });
  }

  private async reload(generation: number) {
    const { root } = this.target;
    const live = this.options.live();
    const stale = () => generation !== this.generation || this.disposed;
    const loaded = await this.load(root, { homeDir: this.home });
    if (stale()) return;
    const errors = [...loaded.errors];
    const warnings = [...loaded.warnings];
    let compiled: CompiledFactory | null = null;
    if (loaded.factory) {
      const projectIdForPath = await projectResolver(
        live?.projects() ?? [],
        live?.data() ?? null,
      );
      const result = compileFactory(loaded.factory, { projectIdForPath });
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      compiled = result.compiled;
    }
    const ids = await readIds(root);
    const revision = await this.revisionOf(root).catch(() => null);
    if (stale()) return;
    this.errors = errors;
    this.warnings = warnings;
    if (compiled) {
      this.compiled = compiled;
      this.fileIds = ids;
    }
    this.revision = revision;
    this.loadedAt = new Date(this.now()).toISOString();
    await this.rewatch(root, generation);
    if (this.compiled) await this.refreshDiff();
  }

  private async refreshDiff(): Promise<void> {
    if (this.diffing) return this.diffing;
    const generation = this.generation;
    const work = (async () => {
      const live = this.options.live();
      const compiled = this.compiled;
      if (!live || !compiled) return;
      const revision = live.revision();
      const data = live.data();
      const prompts = {
        workers: Object.fromEntries(
          await Promise.all(
            data.orchestrators.map(
              async (orchestrator) =>
                [
                  orchestrator.id,
                  await readText(
                    path.join(
                      this.options.profilesRoot,
                      orchestrator.id,
                      "system-prompt.md",
                    ),
                  ),
                ] as const,
            ),
          ),
        ),
        pm: await readText(
          path.join(
            this.options.profilesRoot,
            ASSISTANT_PROFILE,
            "system-prompt.md",
          ),
        ),
      };
      if (generation !== this.generation) return;
      this.differences = diffFactory(
        compiled,
        {
          orchestrator: data.orchestrator,
          orchestrators: data.orchestrators,
          settings: data.settings,
          night: data.night,
          assistant: data.assistant.settings,
          prompts,
        },
        this.fileIds ?? idsByName(data),
      );
      this.diffRevision = revision;
    })();
    this.diffing = work;
    try {
      await work;
    } finally {
      this.diffing = null;
    }
  }

  /** Watches the folders that exist now; a missing root is looked for again every 30 s. */
  private async rewatch(root: string, generation: number) {
    const folders = new Set(await factoryFolders(root));
    if (generation !== this.generation || this.disposed) return;
    let rootExists = true;
    try {
      await readdir(root);
    } catch {
      rootExists = false;
    }
    if (generation !== this.generation || this.disposed) return;
    for (const [folder, unwatch] of this.watchers)
      if (!folders.has(folder) || !rootExists) {
        unwatch();
        this.watchers.delete(folder);
      }
    if (!rootExists) {
      clearTimeout(this.retry);
      this.retry = setTimeout(() => {
        this.retry = undefined;
        this.schedule(0);
      }, MISSING_RETRY_MS);
      return;
    }
    for (const folder of folders)
      if (!this.watchers.has(folder))
        this.watchers.set(
          folder,
          this.watch(folder, () => this.schedule(this.debounceMs)),
        );
  }
}

function projectsKeyOf(
  projects: ReadonlyArray<{ id: string; directory: string }>,
): string {
  return projects
    .map((project) => `${project.id}\0${project.directory}`)
    .sort()
    .join("\n");
}

/**
 * Real path → Paseo project id. Two projects may share a checkout (one path a symlink to the
 * other); the one the live data names wins, as in the export.
 */
async function projectResolver(
  projects: ReadonlyArray<{ id: string; directory: string }>,
  data: Data | null,
): Promise<(realPath: string) => string | null> {
  const named = new Set<string>();
  if (data) {
    for (const orchestrator of data.orchestrators)
      if (orchestrator.projectId) named.add(orchestrator.projectId);
    for (const id of Object.keys(data.assistant.settings.projects))
      named.add(id);
  }
  const byPath = new Map<string, string>();
  for (const project of projects) {
    let real: string;
    try {
      real = await realpath(project.directory);
    } catch {
      continue;
    }
    const current = byPath.get(real);
    if (!current || (!named.has(current) && named.has(project.id)))
      byPath.set(real, project.id);
  }
  return (realPath) => byPath.get(realPath) ?? null;
}

async function readIds(root: string): Promise<LiveIds | null> {
  try {
    const parsed = idsFileSchema.safeParse(
      JSON.parse(await readFile(path.join(root, IDS_FILE), "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
