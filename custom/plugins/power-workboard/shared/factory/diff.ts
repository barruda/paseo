// CUSTOM(factory): what shadow mode reports: the fields where the compiled factory and the live
// config (`workboard-data.json` and the profile prompts) disagree. Ids are the factory's; live
// orchestrators and pools are renamed through the export's id map first.
import type { AssistantSettings } from "../assistant";
import {
  orderedGroups,
  type NightSettings,
  type Orchestrator,
  type OrchestratorConfig,
  type Settings,
} from "../model";
import type { SkillSelection } from "../profiles";
import type { CompiledFactory } from "./compile";
import type { FactoryDifference } from "./status";

export type LiveConfig = {
  orchestrator: Orchestrator;
  orchestrators: OrchestratorConfig[];
  settings: Settings;
  night: NightSettings;
  assistant: Pick<
    AssistantSettings,
    "enabled" | "defaultAction" | "projects" | "chat"
  >;
  /** `system-prompt.md` of each profile, by orchestrator id; null skips the prompts. */
  prompts: { workers: Record<string, string>; pm: string } | null;
};

/** Live id → factory id, as `.factory-ids.json` keeps them. */
export type LiveIds = {
  workers: Record<string, string>;
  pools: Record<string, string>;
};

const VALUE_LIMIT = 200;

/** JSON text of a value, cut to a readable length; null when the side has no such value. */
export function shownValue(value: unknown): string | null {
  if (value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > VALUE_LIMIT
    ? `${text.slice(0, VALUE_LIMIT)}… (${text.length} chars)`
    : text;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Walks objects key by key; arrays and scalars are compared whole. */
function walk(
  path: string,
  live: unknown,
  factory: unknown,
  out: FactoryDifference[],
) {
  if (isRecord(live) && isRecord(factory)) {
    const keys = [...new Set([...Object.keys(live), ...Object.keys(factory)])];
    for (const key of keys.sort())
      walk(`${path}.${key}`, live[key], factory[key], out);
    return;
  }
  if (!same(live, factory))
    out.push({ path, live: shownValue(live), factory: shownValue(factory) });
}

/** Items keyed by id, plus an `order` entry when the shared ids come in another order. */
function walkList<T>(
  path: string,
  live: T[],
  factory: T[],
  idOf: (item: T) => string,
  out: FactoryDifference[],
) {
  const liveById = new Map(live.map((item) => [idOf(item), item]));
  const factoryById = new Map(factory.map((item) => [idOf(item), item]));
  for (const id of [...new Set([...liveById.keys(), ...factoryById.keys()])])
    walk(`${path}.${id}`, liveById.get(id), factoryById.get(id), out);
  const liveOrder = live.map(idOf).filter((id) => factoryById.has(id));
  const factoryOrder = factory.map(idOf).filter((id) => liveById.has(id));
  if (!same(liveOrder, factoryOrder))
    out.push({
      path: `${path}.order`,
      live: shownValue(liveOrder),
      factory: shownValue(factoryOrder),
    });
}

/** "all" keeps no names in the factory; stale names in the live data mean nothing. */
const skills = (value: SkillSelection): SkillSelection =>
  value.mode === "all" ? { mode: "all", names: [] } : value;

export function diffFactory(
  compiled: CompiledFactory,
  live: LiveConfig,
  ids: LiveIds,
): FactoryDifference[] {
  const out: FactoryDifference[] = [];
  const poolId = (id: string | null) => (id ? (ids.pools[id] ?? id) : null);

  // The default task prompt of new orchestrators has no place in the factory (the export warns).
  const { instructions: _defaultPrompt, ...defaults } = live.orchestrator;
  const { instructions: _none, ...compiledDefaults } = compiled.orchestrator;
  walk("defaults", defaults, compiledDefaults, out);

  const workerId = (orchestrator: OrchestratorConfig) =>
    ids.workers[orchestrator.id] ?? orchestrator.id;
  const liveWorkers = live.orchestrators.map((orchestrator) => ({
    ...orchestrator,
    id: workerId(orchestrator),
    instructions: orchestrator.instructions.trim(),
    skills: skills(orchestrator.skills),
    poolId: poolId(orchestrator.poolId),
  }));
  walkList(
    "workers",
    liveWorkers,
    compiled.orchestrators,
    (worker) => worker.id,
    out,
  );
  if (live.prompts) {
    const compiledPrompts = new Map(
      compiled.workers.map((worker) => [worker.id, worker.systemPrompt]),
    );
    for (const orchestrator of live.orchestrators) {
      const id = workerId(orchestrator);
      const factoryPrompt = compiledPrompts.get(id);
      if (factoryPrompt === undefined) continue; // Already reported as a missing worker.
      walk(
        `workers.${id}.systemPrompt`,
        (live.prompts.workers[orchestrator.id] ?? "").trim(),
        factoryPrompt.trim(),
        out,
      );
    }
    walk(
      "pm.systemPrompt",
      live.prompts.pm.trim(),
      compiled.pm.systemPrompt.trim(),
      out,
    );
  }

  walkList(
    "board.columns",
    orderedGroups(live.settings),
    orderedGroups(compiled.settings),
    (group) => group.id,
    out,
  );
  walkList(
    "board.pools",
    live.settings.pools.map((pool) => ({ ...pool, id: poolId(pool.id)! })),
    compiled.settings.pools,
    (pool) => pool.id,
    out,
  );
  for (const key of [
    "autoArchive",
    "archiveAfterDays",
    "pinInProgressWorkspaces",
    "tmpCleanup",
  ] as const)
    walk(`board.${key}`, live.settings[key], compiled.settings[key], out);
  walk("night", live.night, compiled.night, out);

  walk("pm.enabled", live.assistant.enabled, compiled.assistant.enabled, out);
  walk(
    "pm.chat",
    { ...live.assistant.chat, skills: skills(live.assistant.chat.skills) },
    compiled.assistant.chat,
    out,
  );
  walk(
    "delivery.defaultAction",
    live.assistant.defaultAction,
    compiled.assistant.defaultAction,
    out,
  );
  walk("projects", live.assistant.projects, compiled.assistant.projects, out);
  return out;
}
