// CUSTOM(factory): the board's config as the factory's files hold it, the reverse of the compiler.
// The export writes these objects; active mode's UI edits diff two of them and write only the keys
// that changed (server/factory/writer.ts), so an inherited or commented key stays as it is.
import type {
  AssistantChatSettings,
  AssistantSettings,
  ProjectPolicy,
} from "../assistant";
import { projectTestsSchema } from "../assistant";
import {
  DEFAULT_LABELS,
  orderedGroups,
  type NightSettings,
  type Orchestrator,
  type OrchestratorConfig,
  type Settings,
} from "../model";
import type { SkillSelection } from "../profiles";
import { AUTOMATIC_SCHEDULE, type Schedule } from "../schedule";
import { factoryIdSchema, type FactorySchedule } from "./schema";

/** A factory id from a display name: lowercase ASCII, digits and dashes. */
export function slugOf(value: string, fallback: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 72)
    .replace(/-+$/, "");
  return factoryIdSchema.safeParse(slug).success ? slug : fallback;
}

export const permissionOf = (modeId: string | null) => modeId ?? "full";

export function factoryScheduleOf(schedule: Schedule): FactorySchedule {
  if (schedule.kind === "manual") return "manual";
  const allDays = (days: number[]) =>
    days.length === 7 && days.every((day, index) => day === index);
  if (
    schedule.kind === "window" &&
    JSON.stringify(schedule) === JSON.stringify(AUTOMATIC_SCHEDULE)
  )
    return "automatic";
  const days = allDays(schedule.days) ? {} : { days: schedule.days };
  return schedule.kind === "window"
    ? { window: { ...days, start: schedule.start, end: schedule.end } }
    : { daily: { ...days, times: schedule.times } };
}

export const factorySkillsOf = (skills: SkillSelection) =>
  skills.mode === "all" ? "all" : skills.names;

/** A worker's frontmatter, except `role`, `description` and `priority` (the board has none). */
export function workerFrontOf(
  config: OrchestratorConfig,
  refs: { project: string | null; pool: string | null },
) {
  return {
    name: config.name,
    project: refs.project,
    enabled: config.enabled,
    model: config.provider,
    thinking: config.thinkingOptionId,
    permission: permissionOf(config.modeId),
    autoAccept: config.autoAccept,
    workspace: config.useWorktree ? "worktree" : "folder",
    maxConcurrent: config.maxConcurrent,
    batchSize: config.batchSize,
    maxCheckpoints: config.maxCheckpoints,
    pool: refs.pool,
    schedule: factoryScheduleOf(config.schedule),
    skills: factorySkillsOf(config.skills),
    memory: config.memory,
  };
}

/** factory.yaml's `defaults`: what new workers start from and the default delivery. */
export function factoryDefaultsOf(
  orchestrator: Orchestrator,
  defaultAction: AssistantSettings["defaultAction"],
) {
  return {
    defaults: {
      worker: {
        model: orchestrator.provider,
        thinking: orchestrator.thinkingOptionId,
        permission: permissionOf(orchestrator.modeId),
        autoAccept: orchestrator.autoAccept,
        workspace: orchestrator.useWorktree ? "worktree" : "folder",
      },
      delivery: { action: defaultAction },
    },
  };
}

/** pm/worker.md's frontmatter, except `role`. */
export function pmFrontOf(
  enabled: boolean,
  chat: AssistantChatSettings,
  refineModeId: string | null,
) {
  return {
    enabled,
    model: chat.provider,
    thinking: chat.thinkingOptionId,
    permission: permissionOf(chat.modeId),
    autoAccept: chat.autoAccept,
    skills: factorySkillsOf(chat.skills),
    memory: chat.memory,
    wake: {
      onNeedsYou: chat.wakeOnNeedsYou,
      delaySeconds: chat.wakeDelaySeconds,
    },
    compactAtTokens: chat.compactAtTokens,
    interactivePermission: permissionOf(refineModeId),
  };
}

/** board.yaml. `poolId` maps a live pool id to its factory id. */
export function boardFileOf(
  settings: Settings,
  night: NightSettings,
  poolId: (liveId: string) => string,
) {
  const labeled = new Set<string>();
  const columns = orderedGroups(settings).map((group) => {
    const automatic = labeled.has(group.kind)
      ? `pwb:${group.id}`
      : DEFAULT_LABELS[group.kind];
    labeled.add(group.kind);
    return {
      id: group.id,
      kind: group.kind,
      ...(group.name ? { name: group.name } : {}),
      ...(group.label !== automatic ? { label: group.label } : {}),
      ...(group.color ? { color: group.color } : {}),
    };
  });
  return {
    columns,
    pools: settings.pools.map((pool) => ({ ...pool, id: poolId(pool.id) })),
    night,
    housekeeping: {
      autoArchive: settings.autoArchive,
      archiveAfterDays: settings.archiveAfterDays,
      pinInProgressWorkspaces: settings.pinInProgressWorkspaces,
      tmpCleanup: settings.tmpCleanup,
    },
  };
}

/**
 * A project file's `delivery` and `tests`; none without a policy. `tests` is left out while the
 * gate matches today's defaults, which the compiler fills in again.
 */
export function projectPolicyOf(policy: ProjectPolicy | undefined): {
  delivery?: Record<string, unknown>;
  tests?: Record<string, unknown>;
} {
  if (!policy) return {};
  const front: { delivery: Record<string, unknown> } = {
    delivery: {
      action: policy.action,
      observe: policy.observe,
      baseBranch: policy.baseBranch,
      verifyCommand: policy.verifyCommand,
      autoFixes: policy.autoFixes,
    },
  };
  const tests = policy.tests;
  if (JSON.stringify(tests) === JSON.stringify(projectTestsSchema.parse({})))
    return front;
  return {
    ...front,
    tests: {
      gate: {
        command: tests.gateCommand,
        setup: tests.gateSetupCommand,
        requiredEnv: tests.gateRequiredEnv,
        env: tests.gateEnv,
        runIn: tests.gateRunIn,
        riskPaths: tests.gateRiskPaths,
      },
    },
  };
}
