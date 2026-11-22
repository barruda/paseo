// CUSTOM(factory): active mode (docs/factory.md, "Active mode"). The compiled factory replaces the
// config fields of the board data on every read, and every write puts the JSON's own values back,
// so `workboard-data.json` keeps its config untouched and only its runtime state changes.
import {
  defaultGroup,
  defaultWorkspaceGroup,
  type Data,
  type Group,
  type Settings,
} from "../model";
import type { AssistantSettings } from "../assistant";
import type { CompiledFactory, CompiledWorker } from "./compile";
import type { PipelineFile } from "./schema";

/** Live id → factory id, as `.factory-ids.json` and `data.factoryIds` keep them. */
export type FactoryIdMap = {
  workers: Record<string, string>;
  pools: Record<string, string>;
};

/** What the board needs of a factory that active mode applies. */
export type AppliedFactory = {
  root: string;
  revision: string | null;
  compiled: CompiledFactory;
  /** `.factory-ids.json`; null when the file is missing. */
  fileIds: FactoryIdMap | null;
  /** `pipelines/*.yaml` as loaded, for the Pipelines tab. */
  pipelines: Record<string, PipelineFile>;
  /** `defaults.pipeline` of factory.yaml. */
  defaultPipeline: string | null;
};

/** The Pipelines tab's source in active mode: the factory's pipelines and each project's. */
export function factoryPipelinesView(applied: AppliedFactory): {
  source: "factory";
  pipelines: Record<string, PipelineFile>;
  projects: Record<string, string>;
  defaultPipeline: string;
} {
  const projects: Record<string, string> = {};
  for (const project of applied.compiled.projects)
    if (project.pipeline) projects[project.projectId] = project.pipeline;
  return {
    source: "factory",
    pipelines: applied.pipelines,
    projects,
    defaultPipeline: applied.defaultPipeline ?? "default",
  };
}

/** The `settings` fields board.yaml owns; the default-column preferences stay in the JSON. */
export const FACTORY_SETTINGS_KEYS = [
  "groups",
  "groupOrder",
  "pools",
  "autoArchive",
  "archiveAfterDays",
  "pinInProgressWorkspaces",
  "tmpCleanup",
] as const satisfies ReadonlyArray<keyof Settings>;

/** The `assistant.settings` fields the factory owns; `factory` and the legacy `reviews` map stay in the JSON (the export reads `reviews`; nothing writes it). */
export const FACTORY_ASSISTANT_KEYS = [
  "enabled",
  "defaultAction",
  "projects",
  "chat",
] as const satisfies ReadonlyArray<keyof AssistantSettings>;

/**
 * Both directions of the id map; the data's entries win over the file's, both for a live id the
 * two map differently and for a factory id two live ids map to (an orchestrator recreated under
 * the same name before a new export): the first live id the data has keeps the worker.
 */
export class FactoryIds {
  private readonly toFactory: FactoryIdMap;
  private readonly toLive: FactoryIdMap = { workers: {}, pools: {} };

  constructor(data: FactoryIdMap, file: FactoryIdMap | null) {
    this.toFactory = {
      workers: { ...file?.workers, ...data.workers },
      pools: { ...file?.pools, ...data.pools },
    };
    for (const kind of ["workers", "pools"] as const)
      for (const entries of [data[kind], file?.[kind] ?? {}])
        for (const [live, factory] of Object.entries(entries))
          if (this.toFactory[kind][live] === factory)
            this.toLive[kind][factory] ??= live;
  }

  /** The orchestrator id a factory worker runs under: its live id when it had one. */
  liveWorker(factoryId: string): string {
    return this.toLive.workers[factoryId] ?? factoryId;
  }

  livePool(factoryId: string): string {
    return this.toLive.pools[factoryId] ?? factoryId;
  }

  factoryWorker(liveId: string): string {
    return this.toFactory.workers[liveId] ?? liveId;
  }
}

/** The compiled worker an orchestrator id runs, or null when the factory has none. */
export function workerOf(
  applied: AppliedFactory,
  ids: FactoryIds,
  orchestratorId: string,
): CompiledWorker | null {
  return (
    applied.compiled.workers.find(
      (worker) => ids.liveWorker(worker.id) === orchestratorId,
    ) ?? null
  );
}

/** Entries of `.factory-ids.json` the data does not have yet; null when there are none. */
export function missingFactoryIds(
  data: FactoryIdMap,
  file: FactoryIdMap | null,
): FactoryIdMap | null {
  if (!file) return null;
  const missing: FactoryIdMap = { workers: {}, pools: {} };
  let any = false;
  for (const kind of ["workers", "pools"] as const)
    for (const [live, factory] of Object.entries(file[kind]))
      if (!(live in data[kind])) {
        missing[kind][live] = factory;
        any = true;
      }
  return any ? missing : null;
}

/**
 * Puts the compiled factory into `data` (a copy the caller owns). Orchestrators and pools keep the
 * ids they had on the live board, so running tasks, runtime state and logs stay theirs.
 */
export function applyFactory(data: Data, applied: AppliedFactory): void {
  const { compiled } = applied;
  const ids = new FactoryIds(data.factoryIds, applied.fileIds);
  const pool = (id: string | null) => (id === null ? null : ids.livePool(id));
  // The default task prompt of new orchestrators has no place in the factory and stays in the JSON.
  data.orchestrator = {
    ...structuredClone(compiled.orchestrator),
    instructions: data.orchestrator.instructions,
  };
  data.orchestrators = compiled.orchestrators.map((config) => ({
    ...structuredClone(config),
    id: ids.liveWorker(config.id),
    poolId: pool(config.poolId),
  }));
  const settings = structuredClone(compiled.settings);
  settings.pools = settings.pools.map((entry) => ({
    ...entry,
    id: ids.livePool(entry.id),
  }));
  for (const key of FACTORY_SETTINGS_KEYS)
    (data.settings as Record<string, unknown>)[key] = settings[key];
  data.night = structuredClone(compiled.night);
  const assistant = structuredClone(compiled.assistant);
  data.assistant.settings.enabled = assistant.enabled;
  data.assistant.settings.defaultAction = assistant.defaultAction;
  data.assistant.settings.projects = assistant.projects;
  data.assistant.settings.chat = assistant.chat;
}

/** Undoes `applyFactory` on `next` before a save: the JSON keeps its own config fields. */
export function restoreJsonConfig(next: Data, saved: Readonly<Data>): void {
  next.orchestrator = {
    ...structuredClone(saved.orchestrator),
    instructions: next.orchestrator.instructions,
  };
  next.orchestrators = structuredClone(saved.orchestrators);
  for (const key of FACTORY_SETTINGS_KEYS)
    (next.settings as Record<string, unknown>)[key] = structuredClone(
      saved.settings[key],
    );
  next.night = structuredClone(saved.night);
  for (const key of FACTORY_ASSISTANT_KEYS)
    (next.assistant.settings as Record<string, unknown>)[key] = structuredClone(
      saved.assistant.settings[key],
    );
}

/** A task `moveOffUnknownColumns` moved. */
export type ColumnMove = {
  taskId: string;
  title: string;
  from: string;
  to: string;
};

/**
 * Leaving active mode: the JSON's `groups` come back, and a task in a column only the factory had
 * would sit in an unknown one. Moves each to the JSON's default column (its default draft column,
 * or for a task with a workspace the default start column) and returns the moves.
 */
export function moveOffUnknownColumns(
  data: Data,
  groups: readonly Group[],
): ColumnMove[] {
  const known = new Set(groups.map((group) => group.id));
  const moves: ColumnMove[] = [];
  for (const task of data.tasks) {
    const from = task.workspaceId ? task.lastStage : task.draftStage;
    if (from === "conflict" || known.has(from)) continue;
    const to = task.workspaceId
      ? defaultWorkspaceGroup(groups, data.settings.defaultStartGroup)
      : defaultGroup(groups, data.settings.defaultDraftGroup);
    if (task.workspaceId) task.lastStage = to;
    else task.draftStage = to;
    moves.push({ taskId: task.id, title: task.title, from, to });
  }
  return moves;
}
