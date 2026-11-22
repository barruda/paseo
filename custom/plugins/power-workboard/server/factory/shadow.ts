// CUSTOM(factory): shadow and active mode (docs/factory.md, tickets 7, 9 and 10). Watches the
// factory folder, loads and compiles it 500 ms after the last change, and diffs it against the
// config in workboard-data.json. Shadow applies nothing; in active mode `applied()` hands the
// compiled factory to the board (shared/factory/active.ts), and the board's config edits come back
// through `writeConfig` as edits of the factory's files. An invalid factory keeps the last valid
// compile and reports its errors.
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
import type { FactoryIssue, PipelineFile } from "../../shared/factory/schema";
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
import {
  applyFactory,
  restoreJsonConfig,
  type AppliedFactory,
  type FactoryIdMap,
} from "../../shared/factory/active";
import {
  diffFields,
  factoryConfigOf,
  newProjectFile,
  planFactoryEdits,
  sameConfig,
  type FactoryConfig,
  type FieldEdit,
  type FileEdit,
} from "../../shared/factory/edits";
import { renameStageKeys } from "../../shared/factory/pipeline-edit";
import type { AutonomyPresetId } from "../../shared/autonomy";
import type { Data } from "../../shared/model";
import { ASSISTANT_PROFILE } from "../../shared/profiles";
import { homePath, IDS_FILE, slugger } from "./export";
import { loadFactory } from "./loader";
import { factoryRevision } from "./revision";
import type { StoreView } from "../store";
import {
  applyFileEdits,
  commitFactory,
  describeEdits,
  keyEdits,
} from "./writer";

export const FACTORY_DEBOUNCE_MS = 500;
/** While the folder is missing, look for it again this often. */
const MISSING_RETRY_MS = 30_000;
/** Folders below a watched one; `workers/<id>/skills/<name>/` is the deepest the loader reads. */
const MAX_DEPTH = 4;
const HOLD_NOTE =
  "No valid factory yet: no new task starts until the factory compiles";
/** The board's errors for a factory edit it cannot make (client/strings.ts translates them). */
export const FACTORY_NOT_ACTIVE_ERROR =
  "The factory is not active; this setting is saved in the board";
export const FACTORY_HAS_ERRORS_ERROR =
  "The factory has errors; fix its files before editing here";
export const FACTORY_CHANGED_ERROR =
  "The factory changed on disk and was loaded again; check the change and try again";
/** The pipeline editor saved a pipeline the factory no longer has (ticket 14). */
export const FACTORY_PIPELINE_MISSING_ERROR =
  "This pipeline is no longer in the factory";
/**
 * A stage rename whose new id is a base stage that keeps its id, or the new id of another rename:
 * the file would get the key twice.
 */
export const FACTORY_RENAME_COLLISION_ERROR =
  "A renamed stage takes the id of another stage";
/** The project autonomy combobox named a project Paseo no longer has. */
export const FACTORY_PROJECT_MISSING_ERROR =
  "This project is no longer in Paseo";

export type Unwatch = () => void;
/** Calls `changed` on any change of the folder's direct entries. */
export type WatchFolder = (dir: string, changed: () => void) => Unwatch;

/** What the shadow reads of the board; null while the board is down. */
export type ShadowLive = {
  /** Cheap reads, done on every summary. */
  settings: () => FactorySettings;
  /** Changes with every saved change of the data. */
  revision: () => number;
  /** The saved data (without the factory applied), read only when the diff is computed again. */
  data: () => Data;
  projects: () => ReadonlyArray<{ id: string; directory: string }>;
};

export type FactoryShadowOptions = {
  live: () => ShadowLive | null;
  /** The folder an empty `root` setting means (`$PASEO_HOME/factory`). */
  defaultRoot: string;
  /** `<PASEO_HOME>/plugin-data/power-workboard/profiles`, read for the prompts. */
  profilesRoot: string;
  /**
   * Where a worker the UI removes leaves its memory; defaults to `factory-removed/` next to
   * `profilesRoot`.
   */
  removedRoot?: string;
  homeDir?: string;
  debounceMs?: number;
  watch?: WatchFolder;
  load?: typeof loadFactory;
  revision?: (root: string) => Promise<string | null>;
  now?: () => number;
  /** Active mode loaded the factory again: the board reads the new config. */
  applied?: () => void;
};

const idsFileSchema = z.object({
  workers: z.record(z.string(), z.string()).default({}),
  pools: z.record(z.string(), z.string()).default({}),
});

/**
 * Active mode's view of the store: every read gets the compiled factory in its config fields, and
 * every write keeps the JSON's own values there. A write marked `factory` (a user's config edit)
 * first goes to the factory's files; one that is not (the board's own bookkeeping) leaves the
 * factory alone. Other modes read and write the JSON as it is.
 */
export function factoryStoreView(factory: {
  applied(): AppliedFactory | null;
  writeConfig(
    before: FactoryConfig,
    after: FactoryConfig,
    basis: AppliedFactory,
  ): Promise<FactoryIdMap>;
}): StoreView {
  return {
    apply: (data) => {
      const applied = factory.applied();
      if (applied) applyFactory(data, applied);
    },
    restore: (next, saved, options) => {
      const applied = factory.applied();
      if (!applied) return;
      if (!options.factory) {
        restoreJsonConfig(next, saved);
        return;
      }
      const shown = structuredClone(saved) as Data;
      applyFactory(shown, applied);
      const before = factoryConfigOf(shown);
      const after = factoryConfigOf(next);
      restoreJsonConfig(next, saved);
      if (sameConfig(before, after)) return;
      return async () => {
        const ids = await factory.writeConfig(before, after, applied);
        // New workers and pools keep the id the board gave them, so the reply finds them.
        Object.assign(next.factoryIds.workers, ids.workers);
        Object.assign(next.factoryIds.pools, ids.pools);
      };
    },
  };
}

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
  /** The loaded pipeline files and default of the compile above. */
  private pipelines: Pick<
    AppliedFactory,
    "pipelines" | "defaultPipeline" | "pmAutonomy" | "projectAutonomy"
  > = {
    pipelines: {},
    defaultPipeline: null,
    pmAutonomy: null,
    projectAutonomy: {},
  };
  /** The revision of the compile above; `revision` may be a newer, invalid one. */
  private compiledRevision: string | null = null;
  private fileIds: LiveIds | null = null;
  private revision: string | null = null;
  private loadedAt: string | null = null;
  private differences: FactoryDifference[] | null = null;
  /** The live data revision the differences were computed against. */
  private diffRevision: number | null = null;
  private diffing: Promise<void> | null = null;
  /** The factory edit in progress; edits run one at a time. */
  private writing: Promise<unknown> = Promise.resolve();

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
      // Active mode's line shows the revision; shadow's shows the difference count.
      ...(this.target.mode === "active"
        ? { revision: this.compiledRevision }
        : {}),
    };
  }

  /** The factory active mode applies: the last valid compile, or null in other modes or before one. */
  applied(): AppliedFactory | null {
    if (this.target.mode !== "active" || !this.compiled) return null;
    return {
      root: this.target.root,
      revision: this.compiledRevision,
      compiled: this.compiled,
      fileIds: this.fileIds,
      ...this.pipelines,
    };
  }

  /** The setting's mode, read now (the board refuses config edits in active mode). */
  mode(): FactoryMode {
    this.sync();
    return this.target.mode;
  }

  /**
   * Active mode at boot: loads now and waits, so the board's first pass already runs on the
   * factory. A load waiting for its debounce runs at once.
   */
  async ready(): Promise<void> {
    this.sync();
    if (this.target.mode !== "active") return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.run();
    }
    while (this.running) await this.running;
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

  /**
   * Active mode: writes the board's config change (`before` → `after`) to the factory's files,
   * commits it and loads the factory again. Returns the factory ids of the workers and pools it
   * created, keyed by the board's ids.
   */
  async writeConfig(
    before: FactoryConfig,
    after: FactoryConfig,
    basis: AppliedFactory,
  ): Promise<FactoryIdMap> {
    let ids: FactoryIdMap = { workers: {}, pools: {} };
    await this.edit(async (applied) => {
      // `before` was read from `basis`; a load since then may list other workers at its indexes.
      if (
        applied.revision === null
          ? applied.compiled !== basis.compiled
          : applied.revision !== basis.revision
      )
        throw new Error(FACTORY_CHANGED_ERROR);
      const live = this.options.live();
      const data = live?.data();
      const plan = planFactoryEdits(before, after, {
        applied,
        knownIds: [
          ...(data ? [data.factoryIds] : []),
          ...(applied.fileIds ? [applied.fileIds] : []),
        ],
        workerFolders: await folderNames(path.join(applied.root, "workers")),
        projectFiles: new Set(
          [...(await folderNames(path.join(applied.root, "projects"), true))]
            .filter((name) => name.endsWith(".yaml"))
            .map((name) => name.slice(0, -".yaml".length)),
        ),
        projectDirectory: (projectId) =>
          live?.projects().find((project) => project.id === projectId)
            ?.directory ?? null,
        pathText: (directory) => homePath(directory, this.home),
      });
      ids = plan.ids;
      return plan.edits;
    });
    return ids;
  }

  /** Active mode: replaces the prompt (the body) of `pm/worker.md` or `workers/<id>/worker.md`. */
  async writePrompt(file: string, text: string): Promise<void> {
    await this.edit(() => [{ file, body: text, create: "---\n---\n" }]);
  }

  /**
   * Active mode: sets top-level keys of a factory file (a YAML file, or a Markdown file's
   * frontmatter); null removes a key. Any key works, so a new field needs no writer code.
   */
  async writeKeys(
    file: string,
    keys: Record<string, unknown>,
    message?: string,
  ): Promise<void> {
    await this.edit(
      () => [
        {
          file,
          fields: keyEdits(keys),
          create: file.endsWith(".md") ? "---\n---\n" : "",
        },
      ],
      message,
    );
  }

  /**
   * Active mode, the pipeline editor's Save: writes what changed from `base` (the pipeline the
   * editor loaded) to `pipeline` into `pipelines/<id>.yaml`, renaming stage keys in place, and
   * commits. Refuses when the file changed since `base`. `autonomy` is left out on both sides: the
   * editor sets it on its own (setAutonomy), so a draft never undoes it.
   */
  async writePipeline(
    id: string,
    base: PipelineFile,
    pipeline: PipelineFile,
    renames: Record<string, string>,
  ): Promise<void> {
    await this.edit((applied) => {
      if (!Object.hasOwn(applied.pipelines, id))
        throw new Error(FACTORY_PIPELINE_MISSING_ERROR);
      const current = applied.pipelines[id]!;
      if (!sameConfig(withoutAutonomy(current), withoutAutonomy(base)))
        throw new Error(FACTORY_CHANGED_ERROR);
      const known = Object.fromEntries(
        Object.entries(renames).filter(([from]) =>
          Object.hasOwn(base.stages, from),
        ),
      );
      if (renameCollides(base, known))
        throw new Error(FACTORY_RENAME_COLLISION_ERROR);
      const renamed = renameStageKeys(base, known);
      const fields: FieldEdit[] = [
        ...Object.entries(known).flatMap(([from, to]) => [
          { path: ["stages", from], rename: to },
          ...(base.layout && Object.hasOwn(base.layout, from)
            ? [{ path: ["layout", from], rename: to }]
            : []),
        ]),
        ...diffFields(withoutAutonomy(renamed), withoutAutonomy(pipeline)),
      ];
      if (!fields.length) return [];
      return [{ file: `pipelines/${id}.yaml`, fields, target: pipeline }];
    });
  }

  /**
   * Active mode, the autonomy comboboxes: sets or (null) removes `autonomy` in a pipeline's file or
   * in a board project's `projects/<id>.yaml`. A project with no file gets one with its `path`.
   */
  async setAutonomy(
    target: "pipeline" | "project",
    id: string,
    autonomy: AutonomyPresetId | null,
  ): Promise<void> {
    await this.edit(async (applied) => {
      if (target === "pipeline") {
        if (!Object.hasOwn(applied.pipelines, id))
          throw new Error(FACTORY_PIPELINE_MISSING_ERROR);
        return [
          { file: `pipelines/${id}.yaml`, fields: keyEdits({ autonomy }) },
        ];
      }
      const known = applied.compiled.projects.find(
        (project) => project.projectId === id,
      );
      if (known)
        return [
          { file: `projects/${known.id}.yaml`, fields: keyEdits({ autonomy }) },
        ];
      if (autonomy === null) return [];
      const directory = this.options
        .live()
        ?.projects()
        .find((project) => project.id === id)?.directory;
      if (!directory) throw new Error(FACTORY_PROJECT_MISSING_ERROR);
      const taken = new Set(
        [...(await folderNames(path.join(applied.root, "projects"), true))]
          .filter((name) => name.endsWith(".yaml"))
          .map((name) => name.slice(0, -".yaml".length)),
      );
      const { edit } = newProjectFile(directory, taken, (dir) =>
        homePath(dir, this.home),
      );
      return [{ ...edit, fields: keyEdits({ autonomy }) }];
    });
  }

  /**
   * One factory edit: the loaded compile must be valid and current (a file changed on disk since
   * it was read loads it again and refuses the edit), the result must load and compile, then it
   * is committed `ui: <what changed>` and loaded at once, so the reply already shows it.
   */
  private edit(
    build: (applied: AppliedFactory) => FileEdit[] | Promise<FileEdit[]>,
    message?: string,
  ): Promise<void> {
    const work = this.writing.then(async () => {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.run();
      }
      while (this.running) await this.running;
      const applied = this.applied();
      if (!applied) throw new Error(FACTORY_NOT_ACTIVE_ERROR);
      // Nothing to write is no edit, even while the factory is broken or behind.
      const edits = await build(applied);
      if (!edits.length) return;
      if (this.errors.length) throw new Error(FACTORY_HAS_ERRORS_ERROR);
      const root = applied.root;
      if (
        (await this.revisionOf(root).catch(() => null)) !== applied.revision
      ) {
        this.run();
        while (this.running) await this.running;
        throw new Error(FACTORY_CHANGED_ERROR);
      }
      const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, "-");
      const written = await applyFileEdits(root, edits, {
        keepRemoved: (folder) =>
          path.join(
            this.options.removedRoot ??
              path.join(
                path.dirname(this.options.profilesRoot),
                "factory-removed",
              ),
            `${path.basename(folder)}-${stamp}`,
          ),
      });
      if (!written.files.length) return;
      try {
        const problem = await this.problemOf(root);
        if (problem) throw new Error(`The factory edit is invalid: ${problem}`);
        await commitFactory(
          root,
          written.files,
          message ?? describeEdits(edits, written.created),
        );
      } catch (error) {
        await written.undo();
        throw error;
      }
      clearTimeout(this.timer);
      this.timer = undefined;
      this.run();
      while (this.running) await this.running;
    });
    this.writing = work.catch(() => undefined);
    return work;
  }

  /** The first error of the factory as it is on disk now, or null when it loads and compiles. */
  private async problemOf(root: string): Promise<string | null> {
    const live = this.options.live();
    const loaded = await this.load(root, { homeDir: this.home });
    const errors = [...loaded.errors];
    if (loaded.factory) {
      const projectIdForPath = await projectResolver(
        live?.projects() ?? [],
        live?.data() ?? null,
      );
      errors.push(
        ...compileFactory(loaded.factory, { projectIdForPath }).errors,
      );
    }
    return errors[0] ? formatFactoryIssue(errors[0]) : null;
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
    return this.target.mode === "active" && !this.compiled && !this.loading
      ? HOLD_NOTE
      : null;
  }

  private restart(target: Target) {
    const leftActive = this.target.mode === "active" && this.compiled !== null;
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
    this.compiledRevision = null;
    this.fileIds = null;
    this.revision = null;
    this.loadedAt = null;
    this.differences = null;
    this.diffRevision = null;
    this.again = false;
    if (leftActive) this.options.applied?.(); // The board reads the JSON again.
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
    if (compiled && loaded.factory) {
      this.compiled = compiled;
      this.compiledRevision = revision;
      // Without `.factory-ids.json`, the export's ids by name, as the diff uses them.
      this.fileIds = ids ?? (live ? idsByName(live.data()) : null);
      this.pipelines = {
        pipelines: Object.fromEntries(
          loaded.factory.pipelines.map(({ id, pipeline }) => [id, pipeline]),
        ),
        defaultPipeline: loaded.factory.factory.defaults?.pipeline ?? null,
        pmAutonomy: loaded.factory.pm.settings.autonomy ?? null,
        projectAutonomy: Object.fromEntries(
          loaded.factory.projects.flatMap(({ id, settings }) =>
            settings.autonomy ? [[id, settings.autonomy]] : [],
          ),
        ),
      };
    }
    this.revision = revision;
    this.loadedAt = new Date(this.now()).toISOString();
    if (this.target.mode === "active" && compiled) this.options.applied?.();
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

/**
 * True when applying `renames` (base id → new id, base ids only) to the base's stage keys would
 * leave two stages with one id: a target that is a base stage not renamed itself, or a target two
 * renames share. A swap (a → b, b → a) is fine.
 */
export function renameCollides(
  base: PipelineFile,
  renames: Record<string, string>,
): boolean {
  const targets = Object.values(renames);
  if (new Set(targets).size !== targets.length) return true;
  return targets.some(
    (to) => Object.hasOwn(base.stages, to) && !Object.hasOwn(renames, to),
  );
}

/** A pipeline without its `autonomy`, which the editor's Save never writes. */
function withoutAutonomy(
  pipeline: PipelineFile,
): Omit<PipelineFile, "autonomy"> {
  const { autonomy: _autonomy, ...rest } = pipeline;
  return rest;
}

/** Names of a folder's subfolders (or, with `files`, of its files); empty when it is missing. */
async function folderNames(dir: string, files = false): Promise<Set<string>> {
  try {
    return new Set(
      (await readdir(dir, { withFileTypes: true }))
        .filter((entry) => (files ? entry.isFile() : entry.isDirectory()))
        .map((entry) => entry.name),
    );
  } catch {
    return new Set();
  }
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
