// CUSTOM(factory): active mode's UI edits (docs/factory.md, ticket 10). The board changes its
// config as it always did; this turns the change into edits of the factory's files. Each file's
// projection (shared/factory/to-files.ts) is computed before and after, and only the keys that
// differ are written, so inherited and hand-written keys stay as they are.
import type { AssistantSettings } from "../assistant";
import type { Data } from "../model";
import type { AppliedFactory, FactoryIdMap } from "./active";
import {
  boardFileOf,
  factoryDefaultsOf,
  pmFrontOf,
  projectPolicyOf,
  slugOf,
  workerFrontOf,
} from "./to-files";

/** Sets `value` at `path`; `remove` deletes the key instead. */
export type FieldEdit = {
  path: ReadonlyArray<string | number>;
  value?: unknown;
  remove?: boolean;
};

/**
 * One file's change, by path relative to the factory root. A `.md` file's `fields` are its
 * frontmatter and `body` the text after it; any other file is YAML. `target` is the whole projection
 * after the change: a field whose parent the file lacks takes its subtree from there. `create` is
 * the text to start from when the file does not exist, before `fields`. `text` replaces the whole
 * file and null deletes it. `removeFolder` deletes a folder's config files; the writer keeps what
 * the factory's .gitignore leaves out (a worker's `memory/`) outside the factory.
 */
export type FileEdit = {
  file: string;
  fields?: FieldEdit[];
  target?: unknown;
  body?: string;
  create?: string;
  text?: string | null;
  removeFolder?: boolean;
};

/** The parts of the board's data the factory owns. */
export type FactoryConfig = Pick<
  Data,
  "orchestrator" | "orchestrators" | "settings" | "night"
> & {
  assistant: Pick<
    AssistantSettings,
    "enabled" | "defaultAction" | "projects" | "chat"
  >;
};

export function factoryConfigOf(data: Data): FactoryConfig {
  const { enabled, defaultAction, projects, chat } = data.assistant.settings;
  return structuredClone({
    orchestrator: data.orchestrator,
    orchestrators: data.orchestrators,
    settings: data.settings,
    night: data.night,
    assistant: { enabled, defaultAction, projects, chat },
  });
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** JSON with sorted keys, so key order never makes two values differ. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
/** Equal as config: key order and undefined keys do not count. */
export const sameConfig = (a: unknown, b: unknown) =>
  canonical(a) === canonical(b);
const same = sameConfig;

/**
 * The field edits that turn `before` into `after`: maps go key by key, lists of the same length
 * item by item, anything else is replaced whole. An undefined value is a missing key.
 */
export function diffFields(
  before: unknown,
  after: unknown,
  path: Array<string | number> = [],
): FieldEdit[] {
  if (same(before, after)) return [];
  if (after === undefined) return [{ path, remove: true }];
  if (isObject(before) && isObject(after))
    return [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].flatMap((key) => diffFields(before[key], after[key], [...path, key]));
  if (
    Array.isArray(before) &&
    Array.isArray(after) &&
    before.length === after.length &&
    path.length > 0
  )
    return after.flatMap((item, index) =>
      diffFields(before[index], item, [...path, index]),
    );
  return [{ path, value: after }];
}

/** A slug of `value` that `taken` lacks; `-2`, `-3`... on repeats. Adds it to `taken`. */
function freeId(value: string, fallback: string, taken: Set<string>): string {
  const base = slugOf(value, fallback);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

export type PlanContext = {
  applied: AppliedFactory;
  /** Live id → factory id of the saved data and of `.factory-ids.json`. */
  knownIds: FactoryIdMap[];
  /** Folders under `workers/` and files under `projects/` (without `.yaml`) on disk. */
  workerFolders: ReadonlySet<string>;
  projectFiles: ReadonlySet<string>;
  /** The checkout of a Paseo project, for a new project file; null when Paseo has none. */
  projectDirectory: (projectId: string) => string | null;
  /** How a checkout path is written in a project file (`~/...`). */
  pathText: (directory: string) => string;
};

export type FactoryPlan = {
  edits: FileEdit[];
  /** Live id → factory id of the workers and pools the plan creates. */
  ids: FactoryIdMap;
};

const PRIORITY_STEP = 10;
/** The schema's highest `priority`. */
const PRIORITY_MAX = 1000;

/** The file edits that make the factory say `after`, where it says `before` now. */
export function planFactoryEdits(
  before: FactoryConfig,
  after: FactoryConfig,
  context: PlanContext,
): FactoryPlan {
  const { compiled } = context.applied;
  const edits: FileEdit[] = [];
  const ids: FactoryIdMap = { workers: {}, pools: {} };
  /** `create`: the file is optional for the loader, so an edit writes it when it is missing. */
  const fileEdit = (
    file: string,
    from: unknown,
    to: unknown,
    create?: string,
  ) => {
    const fields = diffFields(from, to);
    if (fields.length) edits.push({ file, fields, target: to, create });
  };

  // Pools: applyFactory keeps the compiled order, so the same index is the same pool.
  const poolIds = new Map<string, string>();
  before.settings.pools.forEach((pool, index) => {
    const factoryId = compiled.settings.pools[index]?.id;
    if (factoryId) poolIds.set(pool.id, factoryId);
  });
  const takenPools = new Set([
    ...poolIds.values(),
    ...context.knownIds.flatMap((known) => Object.values(known.pools)),
  ]);
  for (const pool of after.settings.pools) {
    if (poolIds.has(pool.id)) continue;
    // The UI's ids are random; the file gets a slug of the name, as the export does.
    const id = freeId(pool.name, "pool", takenPools);
    poolIds.set(pool.id, id);
    if (id !== pool.id) ids.pools[pool.id] = id;
  }
  const poolOf = (liveId: string | null) =>
    liveId === null ? null : (poolIds.get(liveId) ?? liveId);

  // Projects: by Paseo project id; a project the factory lacks gets a file.
  const projectIds = new Map(
    compiled.projects.map((project) => [project.projectId, project.id]),
  );
  const takenProjects = new Set(context.projectFiles);
  const created = new Set<string>();
  const projectOf = (projectId: string | null): string | null => {
    if (projectId === null) return null;
    const known = projectIds.get(projectId);
    if (known) return known;
    const directory = context.projectDirectory(projectId);
    if (!directory) throw new Error(`Paseo has no project ${projectId}`);
    const name = directory.split(/[\\/]/).filter(Boolean).pop() ?? "project";
    const id = freeId(name, "project", takenProjects);
    projectIds.set(projectId, id);
    created.add(id);
    edits.push({
      file: `projects/${id}.yaml`,
      create: `# yaml-language-server: $schema=../.schema/project.json\npath: ${JSON.stringify(context.pathText(directory))}\n`,
      fields: [],
    });
    return id;
  };

  // Workers: applyFactory keeps the compiled order, so the same index is the same worker.
  const workerIds = new Map<string, string>();
  const priorities = new Map<string, number>();
  before.orchestrators.forEach((config, index) => {
    const worker = compiled.workers[index];
    if (!worker) return;
    workerIds.set(config.id, worker.id);
    priorities.set(worker.id, worker.priority);
  });
  const takenWorkers = new Set([
    ...context.workerFolders,
    ...workerIds.values(),
    ...context.knownIds.flatMap((known) => Object.values(known.workers)),
  ]);
  const afterIds = new Set(after.orchestrators.map((config) => config.id));
  for (const config of before.orchestrators)
    if (!afterIds.has(config.id)) {
      const id = workerIds.get(config.id);
      if (id) edits.push({ file: `workers/${id}`, removeFolder: true });
    }
  const refs = (config: FactoryConfig["orchestrators"][number]) => ({
    project: projectOf(config.projectId),
    pool: poolOf(config.poolId),
  });
  const beforeById = new Map(
    before.orchestrators.map((config) => [config.id, config]),
  );
  const fresh = new Set<string>();
  for (const config of after.orchestrators) {
    const previous = beforeById.get(config.id);
    const front = workerFrontOf(config, refs(config));
    if (previous && workerIds.has(config.id)) {
      const id = workerIds.get(config.id)!;
      fileEdit(
        `workers/${id}/worker.md`,
        workerFrontOf(previous, refs(previous)),
        front,
      );
      if (previous.instructions.trim() !== config.instructions.trim())
        edits.push({
          file: `workers/${id}/task-prompt.md`,
          text: config.instructions.trim()
            ? `${config.instructions.trim()}\n`
            : null,
        });
      continue;
    }
    const id = freeId(config.name, "worker", takenWorkers);
    workerIds.set(config.id, id);
    fresh.add(id);
    if (id !== config.id) ids.workers[config.id] = id;
    const { name, project, ...settings } = front;
    const target = { name, role: "implement", project, ...settings };
    edits.push({
      file: `workers/${id}/worker.md`,
      create: "---\n---\n",
      fields: diffFields({}, target),
      target,
    });
    if (config.instructions.trim())
      edits.push({
        file: `workers/${id}/task-prompt.md`,
        text: `${config.instructions.trim()}\n`,
      });
  }

  // Order is `priority`, then id. New workers at the end go after the rest; any other move, or
  // one that would leave the schema's range, numbers every worker again in steps of 10 (1 past
  // 100 workers).
  const order = after.orchestrators.map((config) => workerIds.get(config.id)!);
  const kept = order.filter((id) => !fresh.has(id));
  const keptBefore = before.orchestrators
    .map((config) => workerIds.get(config.id))
    .filter((id): id is string => !!id && kept.includes(id));
  const appendedOnly =
    same(kept, keptBefore) &&
    order.slice(0, kept.length).every((id) => !fresh.has(id));
  const wanted = new Map<string, number>();
  const last =
    Math.max(-PRIORITY_STEP, ...kept.map((id) => priorities.get(id)!)) +
    PRIORITY_STEP * (order.length - kept.length);
  if (appendedOnly && last <= PRIORITY_MAX)
    order
      .slice(kept.length)
      .forEach((id, index, added) =>
        wanted.set(id, last - PRIORITY_STEP * (added.length - 1 - index)),
      );
  else {
    const step = order.length > 100 ? 1 : PRIORITY_STEP;
    order.forEach((id, index) => wanted.set(id, index * step));
  }
  for (const [id, priority] of wanted) {
    if (priorities.get(id) === priority) continue;
    const field: FieldEdit = { path: ["priority"], value: priority };
    const edit = edits.find(
      (entry) => entry.file === `workers/${id}/worker.md`,
    );
    if (edit) edit.fields = [...(edit.fields ?? []), field];
    else edits.push({ file: `workers/${id}/worker.md`, fields: [field] });
  }

  // Project policies, keyed by Paseo project id.
  for (const projectId of new Set([
    ...Object.keys(before.assistant.projects),
    ...Object.keys(after.assistant.projects),
  ])) {
    const from = before.assistant.projects[projectId];
    const to = after.assistant.projects[projectId];
    if (same(from, to)) continue;
    const id = projectOf(projectId)!;
    const fields = diffFields(projectPolicyOf(from), projectPolicyOf(to));
    const target = projectPolicyOf(to);
    const edit = created.has(id)
      ? edits.find((entry) => entry.file === `projects/${id}.yaml`)
      : undefined;
    if (edit) {
      edit.fields = fields;
      edit.target = target;
    } else if (fields.length)
      edits.push({ file: `projects/${id}.yaml`, fields, target });
  }

  fileEdit(
    "factory.yaml",
    factoryDefaultsOf(before.orchestrator, before.assistant.defaultAction),
    factoryDefaultsOf(after.orchestrator, after.assistant.defaultAction),
  );
  fileEdit(
    "board.yaml",
    boardFileOf(before.settings, before.night, (id) => poolOf(id)!),
    boardFileOf(after.settings, after.night, (id) => poolOf(id)!),
    "",
  );
  fileEdit(
    "pm/worker.md",
    pmFrontOf(
      before.assistant.enabled,
      before.assistant.chat,
      before.orchestrator.refineModeId,
    ),
    pmFrontOf(
      after.assistant.enabled,
      after.assistant.chat,
      after.orchestrator.refineModeId,
    ),
    "---\n---\n",
  );
  return { edits, ids };
}
