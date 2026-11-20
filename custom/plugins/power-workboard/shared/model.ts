import { z } from "zod";
import { scheduleSchema, timeOfDaySchema } from "./schedule";
import {
  assistantDataSchema,
  reportOptionSchema, // CUSTOM(assistant-cards)
  taskProgressSchema,
} from "./assistant"; // CUSTOM(projects-assistant), CUSTOM(task-checkpoints)
import { skillSelectionSchema } from "./profiles"; // CUSTOM(agent-profiles)
import { orchestratorHoldSchema, type OrchestratorHold } from "./hold"; // CUSTOM(resource-pools)

export const STAGES = [
  "inbox",
  "todo",
  // CUSTOM(night-tasks): night tasks and tasks with a start time wait here; drafts only.
  "scheduled",
  // A refined task the orchestrator may start; still a draft without a workspace.
  "ready",
  "in-progress",
  "review",
  "done",
  "canceled",
] as const;
export const stageKindSchema = z.enum(STAGES);
export type StageKind = z.infer<typeof stageKindSchema>;
export const stageSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(100)
  .refine((id) => id !== "conflict");
export type Stage = z.infer<typeof stageSchema>;
export type BoardStage = Stage | "conflict";
// The plugin uses its own labels, so it never takes over the original Workboard's columns.
export const DEFAULT_LABELS: Record<StageKind, string> = {
  inbox: "pwb:inbox",
  todo: "pwb:backlog",
  scheduled: "pwb:scheduled",
  ready: "pwb:ready",
  "in-progress": "pwb:in-progress",
  review: "pwb:review",
  done: "pwb:done",
  canceled: "pwb:canceled",
};
export const STAGE_COLORS = {
  inbox: "indigo",
  todo: "sky",
  scheduled: "indigo",
  ready: "indigo",
  "in-progress": "blue",
  review: "orange",
  done: "emerald",
  canceled: "red",
} as const;
export const labelKey = (name: string) =>
  name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
const labelName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((name) => name.replace(/\s+/g, " "));
export const GROUP_COLORS = [
  "gray",
  "blue",
  "cyan",
  "teal",
  "green",
  "amber",
  "orange",
  "violet",
  "pink",
  "red",
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];
// CUSTOM(project-icon-colors): a project's light and dark accent, picked by the theme surface.
export const projectAccentSchema = z.object({
  light: z.string(),
  dark: z.string(),
});
export type ProjectAccent = z.infer<typeof projectAccentSchema>;
export const groupSchema = z.object({
  id: stageSchema,
  name: z.string().trim().min(1).max(80).nullable().default(null),
  kind: stageKindSchema,
  label: labelName,
  color: z.enum(GROUP_COLORS).optional(),
});
export type Group = z.infer<typeof groupSchema>;
// Keep the native named-color contract; visual aliases share its stage mapping.
const LABEL_GROUP_COLORS: Record<(typeof STAGE_COLORS)[StageKind], GroupColor> =
  {
    indigo: "violet",
    sky: "cyan",
    blue: "blue",
    orange: "orange",
    emerald: "green",
    red: "red",
  };
export const groupColorKey = (group: Group): GroupColor =>
  group.color ?? LABEL_GROUP_COLORS[STAGE_COLORS[group.kind]];
export function nextGroupColor(groups: readonly Group[]): GroupColor {
  const counts = new Map<GroupColor, number>(
    GROUP_COLORS.map((color) => [color, 0]),
  );
  for (const group of groups) {
    const color = groupColorKey(group);
    counts.set(color, counts.get(color)! + 1);
  }
  return GROUP_COLORS.reduce((least, color) =>
    counts.get(color)! < counts.get(least)! ? color : least,
  );
}
/** Ready to start feeds the orchestrators; they move a task to In progress and then to Ready to review. */
const DEFAULT_GROUP_NAMES: Partial<Record<StageKind, string>> = {
  todo: "Backlog",
  scheduled: "Scheduled",
  ready: "Ready to start",
  "in-progress": "In progress",
  review: "Ready to review",
  done: "Done",
};
export const DEFAULT_GROUPS: Group[] = (
  ["todo", "scheduled", "ready", "in-progress", "review", "done"] as const
).map((kind) => ({
  id: kind === "todo" ? "backlog" : kind,
  kind,
  name: DEFAULT_GROUP_NAMES[kind] ?? null,
  label: DEFAULT_LABELS[kind],
  ...(kind === "scheduled" ? { color: "teal" as const } : {}),
}));
export const groupsSchema = z
  .array(groupSchema)
  .min(1)
  .superRefine((groups, context) => {
    if (new Set(groups.map((group) => group.id)).size !== groups.length)
      context.addIssue({
        code: "custom",
        message: "Group identities must be unique",
      });
    if (
      new Set(groups.map((group) => labelKey(group.label))).size !==
      groups.length
    )
      context.addIssue({
        code: "custom",
        message: "Each group needs a different label",
      });
    if (!groups.some((group) => group.kind === "todo"))
      context.addIssue({
        code: "custom",
        message: "Keep at least one To do group for drafts",
      });
  });
export const groupOrderSchema = z
  .array(stageSchema)
  .superRefine((order, context) => {
    if (new Set(order).size !== order.length)
      context.addIssue({
        code: "custom",
        message: "Group order cannot contain duplicates",
      });
  });
/**
 * CUSTOM(resource-pools): a limit several orchestrators share, for a resource of this machine
 * (RAM, a Unity Editor). A task starts only with a free slot in its orchestrator and in its pool.
 */
export const poolSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(80),
  maxConcurrent: z.number().int().min(1).max(10).default(1),
  /** Nothing of the pool starts while the machine has less free RAM than this; null: no floor. */
  minFreeRamPercent: z.number().int().min(1).max(95).nullable().default(null),
});
export type Pool = z.infer<typeof poolSchema>;
export const poolsSchema = z.array(poolSchema).superRefine((pools, context) => {
  if (new Set(pools.map((pool) => pool.id)).size !== pools.length)
    context.addIssue({ code: "custom", message: "Pool ids must be unique" });
});
const preferences = {
  autoArchive: z.boolean().default(true),
  archiveMappingNeedsReview: z.boolean().default(false),
  archiveAfterDays: z.number().int().min(0).max(365).default(0),
  defaultDraftGroup: stageSchema.nullable().default(null),
  defaultStartGroup: stageSchema.nullable().default(null),
  defaultStartWorkGroup: stageSchema.nullable().default(null),
  pinInProgressWorkspaces: z.boolean().default(true),
};
// CUSTOM(unattended-automation): remove first-level entries of the scratch folder older than
// this many hours; the board runs the pass at most once an hour.
export const TMP_CLEANUP_DEFAULT_PATH = "/home/bruno/uprojects/tmp";
export const TMP_CLEANUP_DEFAULT_HOURS = 24;
export const TMP_CLEANUP_INTERVAL_MS = 60 * 60_000;
export const tmpCleanupSchema = z.object({
  path: z.string().trim().default(TMP_CLEANUP_DEFAULT_PATH),
  maxAgeHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .default(TMP_CLEANUP_DEFAULT_HOURS),
});
export type TmpCleanup = z.infer<typeof tmpCleanupSchema>;
export const settingsSchema = z.object({
  ...preferences,
  groups: groupsSchema.default(DEFAULT_GROUPS),
  groupOrder: groupOrderSchema.default([]),
  pools: poolsSchema.default([]), // CUSTOM(resource-pools)
  tmpCleanup: tmpCleanupSchema.default(() => tmpCleanupSchema.parse({})),
});
export type Settings = z.infer<typeof settingsSchema>;
export function orderedGroups(
  settings: Pick<Settings, "groups" | "groupOrder">,
): Group[] {
  const remaining = new Map(settings.groups.map((group) => [group.id, group]));
  const ordered: Group[] = [];
  for (const id of settings.groupOrder) {
    const group = remaining.get(id);
    if (group) {
      ordered.push(group);
      remaining.delete(id);
    }
  }
  for (const group of settings.groups)
    if (remaining.has(group.id)) ordered.push(group);
  return ordered;
}
export const defaultGroup = (
  groups: readonly Group[],
  configured: Stage | null = null,
): Stage =>
  (groups.find((group) => group.id === configured && group.kind === "todo") ??
    groups.find((group) => group.kind === "todo"))!.id;
export const defaultWorkspaceGroup = (
  groups: readonly Group[],
  configured: Stage | null = null,
): Stage =>
  (groups.find(
    (group) => group.id === configured && !isTerminalGroup(group.id, groups),
  ) ??
    groups.find((group) => group.kind === "inbox") ??
    groups.find((group) => group.kind === "in-progress") ??
    groups.find((group) => !isTerminalGroup(group.id, groups)) ??
    groups[0])!.id;
export const defaultStartWorkGroup = (
  groups: readonly Group[],
  configured: Stage | null = null,
): Stage | undefined =>
  (
    groups.find(
      (group) => group.id === configured && group.kind === "in-progress",
    ) ?? groups.find((group) => group.kind === "in-progress")
  )?.id;
export const groupKind = (
  stage: Stage,
  groups: readonly Group[],
): StageKind | undefined => groups.find((group) => group.id === stage)?.kind;
export const isDraftGroup = (
  stage: Stage,
  groups: readonly Group[],
): boolean => {
  const kind = groupKind(stage, groups);
  return (
    kind === "inbox" ||
    kind === "todo" ||
    kind === "scheduled" ||
    kind === "ready" ||
    kind === "canceled"
  );
};
export const isTerminalGroup = (
  stage: Stage,
  groups: readonly Group[],
): boolean => {
  const kind = groupKind(stage, groups);
  return kind === "done" || kind === "canceled";
};
const DAY_MS = 24 * 60 * 60 * 1000;
export function statusLabels(
  labels: readonly string[],
  groups: readonly Group[],
): string[] {
  const managed = new Set(groups.map((group) => labelKey(group.label)));
  return [
    ...new Set(labels.filter((label) => managed.has(labelKey(label)))),
  ].sort();
}
export function resolveStage(
  labels: readonly string[],
  groups: readonly Group[],
  configured: Stage | null = null,
): BoardStage {
  const present = new Set(labels.map(labelKey));
  const found = groups.filter((group) => present.has(labelKey(group.label)));
  return found.length > 1
    ? "conflict"
    : (found[0]?.id ?? defaultWorkspaceGroup(groups, configured));
}
export function archiveDueAt(
  conversation: string | null,
  days = 30,
): string | null {
  const time = conversation === null ? NaN : Date.parse(conversation);
  return Number.isFinite(time)
    ? new Date(time + days * DAY_MS).toISOString()
    : null;
}
export function isArchiveDue(
  stage: string | undefined,
  conversation: string | null,
  now: number,
  days = 30,
): boolean {
  const due = archiveDueAt(conversation, days);
  return (
    (stage === "done" || stage === "canceled") &&
    due !== null &&
    (days === 0 ? now >= Date.parse(due) : now > Date.parse(due))
  );
}

/** Only an exact or upper-bound time may gate archiving; a lower bound never may. */
export function archiveGate(
  task: Pick<Task, "conversationGateAt" | "conversationGateEvidence">,
): string | null {
  return task.conversationGateEvidence === "exact" ||
    task.conversationGateEvidence === "upper-bound"
    ? task.conversationGateAt
    : null;
}
/** The card summary of what the display evidence supports. */
export function conversationStatusFor(
  display: ConversationDisplay,
): "known" | "none" | "unknown" {
  if (display === "none") return "none";
  return display === "unknown" ? "unknown" : "known";
}
/**
 * The stored settings version. The plugin registers this same value, because the host only
 * migrates stored settings when the registered version differs from what it finds.
 */
export const DATA_SCHEMA_VERSION = 10;

export const sourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("directory"),
    path: z.string().trim().min(1),
    projectId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("worktree"),
    projectId: z.string().min(1),
    worktreeSlug: z.string().trim().min(1).optional(),
  }),
]);
export const startSchema = z.object({
  taskId: z.string(),
  stage: stageSchema.optional(),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("existing"), workspaceId: z.string() }),
    z.object({ kind: z.literal("new"), source: sourceSchema }),
  ]),
});
export type StartInput = z.infer<typeof startSchema>;
const archiveSchema = z.object({
  operationId: z.string(),
  status: z.enum(["pending", "archived", "uncertain", "external"]),
  kind: z.enum(["automatic", "external", "draft"]),
  stage: z.string(),
  group: groupSchema.nullable().default(null),
  startedAt: z.string(),
  archivedAt: z.string().nullable(),
  lastConversationAt: z.string().nullable(),
  detail: z.string(),
});
/**
 * Display evidence and gate evidence stay separate: a lower bound may be shown to the user
 * but must never trigger automatic archiving, and an upper bound may gate archiving but is
 * not a conversation time when Paseo polluted it with an archive or hydration timestamp.
 */
export const conversationDisplaySchema = z.enum([
  "exact",
  "lower-bound",
  "upper-bound",
  "none",
  "unknown",
]);
export const conversationGateSchema = z.enum([
  "exact",
  "upper-bound",
  "unknown",
]);
export const CONVERSATION_REASONS = [
  "replay-timestamp",
  "truncated-window",
  "timeline-unreadable",
  "child-enumeration-unavailable",
  "child-timeline-unreadable",
] as const;
export const conversationReasonSchema = z.enum(CONVERSATION_REASONS);
export const conversationAgentSchema = z.object({
  id: z.string(),
  lastObservedAt: z.string().nullable().default(null),
  seenWhileLive: z.boolean().default(false),
});
export type ConversationDisplay = z.infer<typeof conversationDisplaySchema>;
export type ConversationGate = z.infer<typeof conversationGateSchema>;
export type ConversationReason = z.infer<typeof conversationReasonSchema>;
export type ConversationAgent = z.infer<typeof conversationAgentSchema>;
/**
 * CUSTOM(night-tasks): when a task in the Scheduled group may start. `night` waits for the night
 * window; `at` moves to Ready to start at that time (ISO, an absolute instant).
 */
export const taskTimingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("night") }),
  z.object({ kind: z.literal("at"), at: z.string().min(1) }),
]);
export type TaskTiming = z.infer<typeof taskTimingSchema>;
/** CUSTOM(night-tasks): the night window and what happens when its tasks are done. */
export const nightSettingsSchema = z.object({
  /** Daemon host's local time; an end before the start crosses midnight. */
  start: timeOfDaySchema.default("22:00"),
  end: timeOfDaySchema.default("06:00"),
  /** Power the computer off once the night's tasks are done (or the window closed). */
  shutdownWhenDone: z.boolean().default(false),
  /** Empty runs the platform default (`systemctl poweroff` on Linux). */
  shutdownCommand: z.string().trim().max(500).default(""),
});
export type NightSettings = z.infer<typeof nightSettingsSchema>;
export const NIGHT_LOG_LIMIT = 30;
/** CUSTOM(night-tasks): the current or last night that ran tasks, and its power-off. */
export const nightRuntimeSchema = z.object({
  /** Start of the window that night tasks last ran in (ISO). */
  windowStart: z.string().nullable().default(null),
  /** Night tasks started in that window. */
  started: z.number().int().min(0).default(0),
  /** A power-off is counting down to this time. */
  shutdownAt: z.string().nullable().default(null),
  /** The window whose power-off already ran or was canceled; it does not arm again. */
  handledFor: z.string().nullable().default(null),
  log: z.array(z.object({ at: z.string(), text: z.string() })).default([]),
});
export type NightRuntime = z.infer<typeof nightRuntimeSchema>;

// CUSTOM(packages): a package groups tickets that already exist so the full suite runs once for
// the package, by script, instead of once per ticket. It is not a board column: `Group` stays the
// column, and `package` is a reserved word in ES modules, so the code uses `Package`/`pkg`.
export const TEST_TIERS = ["restricted", "gate", "full"] as const;
export const testTierSchema = z.enum(TEST_TIERS);
export type TestTier = z.infer<typeof testTierSchema>;
export const testTierOverrideSchema = z.object({
  tier: testTierSchema,
  reason: z.string().max(2000).default(""),
  by: z.enum(["rule", "pm", "user"]).default("pm"),
  at: z.string(),
});
export type TestTierOverride = z.infer<typeof testTierOverrideSchema>;
export const PACKAGE_STATUSES = ["open", "closed"] as const;
export const packageStatusSchema = z.enum(PACKAGE_STATUSES);
export type PackageStatus = z.infer<typeof packageStatusSchema>;
export const PACKAGE_TRIGGERS = ["night", "close", "manual", "merges"] as const;
export const packageTriggerSchema = z.enum(PACKAGE_TRIGGERS);
export type PackageTrigger = z.infer<typeof packageTriggerSchema>;
/** The package gate inherits the project's tests policy; a field here overrides it. */
export const packageGateSchema = z.object({
  command: z.string().max(2000).default(""),
  requiredEnv: z.array(z.string().trim().min(1)).default([]),
  env: z.record(z.string(), z.string()).default({}),
  setupCommand: z.string().max(2000).default(""),
  runIn: z.enum(["worktree", "checkout"]).default("worktree"),
});
export type PackageGate = z.infer<typeof packageGateSchema>;
export const packageSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  projectId: z.string().min(1),
  color: z.enum(GROUP_COLORS).optional(),
  status: packageStatusSchema.default("open"),
  createdAt: z.string(),
  createdBy: z.enum(["user", "assistant"]).default("user"),
  /** 2b: an integration branch; null keeps the tickets merging into the project's base. */
  branch: z.string().trim().max(200).nullable().default(null),
  gate: packageGateSchema.nullable().default(null),
  trigger: z
    .object({
      night: z.boolean().default(true),
      onClose: z.boolean().default(true),
      everyMerges: z.number().int().min(1).max(100).nullable().default(null),
    })
    .default(() => ({ night: true, onClose: true, everyMerges: null })),
  tierPolicy: z
    .object({ escalateOnRisk: z.boolean().default(true) })
    .default(() => ({ escalateOnRisk: true })),
  closedAt: z.string().nullable().default(null),
  /** The night window whose gate already ran, so one night runs it once. */
  lastNightWindowStart: z.string().nullable().default(null),
  /** Merges since the last gate run; the `everyMerges` trigger reads it. */
  mergedSinceGate: z.number().int().min(0).default(0),
});
export type Package = z.infer<typeof packageSchema>;
export const PACKAGE_RUN_STATUSES = [
  "running",
  "passed",
  "failed",
  "missing-deps",
  "error",
] as const;
export const packageRunStatusSchema = z.enum(PACKAGE_RUN_STATUSES);
export type PackageRunStatus = z.infer<typeof packageRunStatusSchema>;
export const PACKAGE_OUTPUT_LIMIT = 8000;
export const PACKAGE_RUN_LIMIT = 50;
export const packageRunSchema = z.object({
  id: z.string(),
  packageId: z.string(),
  trigger: packageTriggerSchema,
  status: packageRunStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
  durationMs: z.number().int().min(0).nullable().default(null),
  /** The integration commit the gate ran at. */
  commit: z.string().nullable().default(null),
  /** Tail of the combined output. */
  output: z.string().max(PACKAGE_OUTPUT_LIMIT).default(""),
  suspectTaskId: z.string().nullable().default(null),
  suspectCommit: z.string().nullable().default(null),
});
export type PackageRun = z.infer<typeof packageRunSchema>;
/** What the board snapshot carries per package: counts and the last run, not the whole history. */
export const packageViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  color: z.enum(GROUP_COLORS),
  status: packageStatusSchema,
  branch: z.string().nullable(),
  trigger: packageSchema.shape.trigger,
  tierPolicy: packageSchema.shape.tierPolicy,
  /** CUSTOM(packages): the gate resolved from the package override and the project policy. */
  gate: z.object({
    command: z.string(),
    requiredEnv: z.array(z.string()),
    env: z.record(z.string(), z.string()),
    setupCommand: z.string(),
    runIn: z.enum(["worktree", "checkout"]),
  }),
  createdAt: z.string(),
  closedAt: z.string().nullable(),
  total: z.number().int().min(0),
  merged: z.number().int().min(0),
  canceled: z.number().int().min(0),
  lastRun: packageRunSchema.nullable(),
  /** Tickets the last failed run points at. */
  suspectTaskIds: z.array(z.string()).default([]),
});
export type PackageView = z.infer<typeof packageViewSchema>;

export const taskSchema = z.object({
  id: z.string(),
  /** CUSTOM(task-numbers): the short, sequential reference shown as `#42`; 0 on pre-v10 data. */
  number: z.number().int().min(0).default(0),
  workspaceId: z.string().nullable(),
  title: z.string().min(1),
  description: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  draftStage: stageSchema,
  lastStage: z.union([stageSchema, z.literal("conflict")]),
  lastConversationAt: z.string().nullable(),
  conversationStatus: z.enum(["known", "none", "unknown"]),
  conversationDisplayEvidence: conversationDisplaySchema.default("unknown"),
  // Paseo's recorded activity: never later than the real last message, but polluted for
  // archived agents, whose updatedAt lands on the archive time instead.
  conversationGateAt: z.string().nullable().default(null),
  conversationGateEvidence: conversationGateSchema.default("unknown"),
  conversationReason: conversationReasonSchema.nullable().default(null),
  conversationAgents: z.array(conversationAgentSchema).default([]),
  mergedDrafts: z
    .array(
      z.object({
        draftId: z.string(),
        title: z.string().min(1),
        description: z.string(),
        mergedAt: z.string(),
        appendedText: z.string().min(1),
      }),
    )
    .default([]),
  issue: z.string().nullable(),
  archived: archiveSchema.nullable(),
  /** The orchestrator that should run this task; null lets any one for its project take it. */
  orchestratorId: z.string().nullable().default(null),
  timing: taskTimingSchema.nullable().default(null), // CUSTOM(night-tasks)
  // CUSTOM(packages): the package this ticket belongs to (at most one), and its test level.
  packageId: z.string().nullable().default(null),
  testTier: testTierOverrideSchema.nullable().default(null),
  binding: z
    .object({
      operationId: z.string(),
      target: startSchema.shape.target,
      workspaceId: z.string().nullable(),
      stage: stageSchema,
    })
    .nullable(),
});
export type Task = z.infer<typeof taskSchema>;
/** What the orchestrator did with one task; kept apart from the task so the board model stays as is. */
export const orchestrationSchema = z.object({
  // `queued`: the reviewer asked for more work; the next pass sends the feedback to the agent.
  // CUSTOM(task-checkpoints): `waiting`: a checkpoint asked to resume at `resumeAt`.
  status: z.enum([
    "starting",
    "running",
    "finished",
    "failed",
    "queued",
    "waiting",
  ]),
  workspaceId: z.string().nullable().default(null),
  agentId: z.string().nullable().default(null),
  startedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
  sawRunning: z.boolean().default(false),
  /** CUSTOM(board-turn-end): since when the agent has been continuously idle; null while it runs. */
  idleSince: z.string().nullable().default(null),
  /**
   * CUSTOM(restart-resume): when this task was resumed after a daemon restart, so the same
   * restart never sends a second "continue" and the turn gets a grace period to start.
   */
  restartResumeAt: z.string().nullable().default(null),
  /** CUSTOM(unattended-automation): since when the agent has been waiting on a permission. */
  permissionSince: z.string().nullable().default(null),
  /** CUSTOM(unattended-automation): this wait was already raised to Needs you. */
  permissionNeedsYou: z.boolean().default(false),
  error: z.string().nullable().default(null),
  /** The agent's last reply when it finished, shown to the reviewer. */
  summary: z.string().nullable().default(null),
  /** What the reviewer asked for when they sent the task back to Ready to start. */
  feedback: z.string().nullable().default(null),
  /** CUSTOM(assistant-cards): who sent that feedback, for the history's `by`. */
  feedbackBy: z.enum(["user", "assistant"]).nullable().default(null),
  /**
   * CUSTOM(assistant-cards): the question of the agent's last report and its options, for the
   * Ready to review card's one-tap answers. Null when the report asked nothing.
   */
  ask: z
    .object({
      question: z.string(),
      options: z.array(reportOptionSchema),
      recommend: z.string().nullable(),
      why: z.string().nullable(),
    })
    .nullable()
    .default(null),
  /** The orchestrator that started it; its log and limits own this run. */
  orchestratorId: z.string().nullable().default(null),
  /** CUSTOM(night-tasks): started as a night task, inside the night window. */
  night: z.boolean().default(false),
  /**
   * CUSTOM(task-checkpoints): queued or waiting after a checkpoint; the task stays in progress and
   * resumes without the user. Neither status holds a slot.
   */
  checkpoint: z.boolean().default(false),
  resumeAt: z.string().nullable().default(null),
  waitingFor: z.string().nullable().default(null),
  /**
   * CUSTOM(usage-limit): the agent stopped on the plan's usage limit. The task waits like a
   * checkpoint (`checkpoint` true, status `waiting`) until `resumeAt`, just after the reset.
   */
  limited: z.boolean().default(false),
  /** CUSTOM(usage-limit): limit pauses in a row; a turn that ends normally resets it. */
  limitPauses: z.number().int().min(0).default(0),
  /**
   * CUSTOM(orchestrator-in-place): the task runs in the project folder instead of a worktree, so
   * only one such task runs there at a time and its delivery commits without merging.
   */
  inPlace: z.boolean().default(false),
  /** CUSTOM(orchestrator-in-place): the folder's HEAD when the task started; the diff's base. */
  baseHead: z.string().nullable().default(null),
  /** CUSTOM(orchestrator-in-place): `git status --porcelain` lines the folder already had. */
  initialDirty: z.array(z.string()).default([]),
});
export type Orchestration = z.infer<typeof orchestrationSchema>;
/**
 * CUSTOM(bulk-orchestrator-agent): `provider/model` with both parts, for the bulk agent change.
 * The stored orchestrator keeps the looser schema above so an old board still loads.
 */
export const providerModelSchema = z
  .string()
  .trim()
  .min(3)
  .refine((value) => {
    const slash = value.indexOf("/");
    return slash > 0 && slash < value.length - 1;
  }, "provider-model-invalid");
/** Agent settings new orchestrators start from; refinement chats use them too. */
export const orchestratorSchema = z.object({
  /** Provider and model in `provider/model` format. */
  provider: z.string().trim().min(3).default("claude/claude-opus-5-5"),
  /**
   * CUSTOM(unattended-automation): for a mode provider this is the permission; empty means full
   * access (the default). For OpenCode and similar it is the agent, and `autoAccept` is the permission.
   */
  modeId: z.string().trim().min(1).nullable().default(null),
  /** CUSTOM(unattended-automation): feature providers auto-accept every prompt by default. */
  autoAccept: z.boolean().default(true),
  thinkingOptionId: z.string().trim().min(1).nullable().default("medium"),
  /** A git project gets one worktree per task; otherwise the agent works in the project folder. */
  useWorktree: z.boolean().default(true),
  instructions: z.string().max(20000).default(""),
  /** Refinement chats only read and talk, so they ask before any edit. */
  refineModeId: z.string().trim().min(1).nullable().default("default"),
});
export type Orchestrator = z.infer<typeof orchestratorSchema>;
/** One orchestrator: which tasks it takes, when, how many, and with which agent. */
export const orchestratorConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  /** null takes unassigned tasks of any project. */
  projectId: z.string().nullable().default(null),
  /** Off: takes no tasks at all (no schedule, no Run now); running agents keep going. */
  enabled: z.boolean().default(true),
  schedule: scheduleSchema.default({ kind: "manual" }),
  maxConcurrent: z.number().int().min(1).max(10).default(2),
  /** Tasks one run (Run now or a daily time) takes in all. */
  batchSize: z.number().int().min(1).max(50).default(5),
  provider: z.string().trim().min(3).default("claude/claude-opus-5-5"),
  /**
   * CUSTOM(unattended-automation): for a mode provider this is the permission; empty means full
   * access (the default). For OpenCode and similar it is the agent, and `autoAccept` is the permission.
   */
  modeId: z.string().trim().min(1).nullable().default(null),
  /** CUSTOM(unattended-automation): feature providers auto-accept every prompt by default. */
  autoAccept: z.boolean().default(true),
  thinkingOptionId: z.string().trim().min(1).nullable().default("medium"),
  useWorktree: z.boolean().default(true),
  instructions: z.string().max(20000).default(""),
  // CUSTOM(agent-profiles): the profile's settings; its content lives in the profile folder.
  skills: skillSelectionSchema.default(() => skillSelectionSchema.parse({})),
  memory: z.boolean().default(true),
  /** CUSTOM(resource-pools): the pool whose limits it shares; null: only its own limit. */
  poolId: z.string().nullable().default(null),
  /** CUSTOM(task-checkpoints): automatic resumes per task before it goes to the user as stalled. */
  maxCheckpoints: z.number().int().min(0).max(50).default(5),
});
export type OrchestratorConfig = z.infer<typeof orchestratorConfigSchema>;
/** What a run still may start, and when the schedule last fired. */
export const orchestratorRuntimeSchema = z.object({
  quota: z.number().int().min(0).default(0),
  started: z.number().int().min(0).default(0),
  runStartedAt: z.string().nullable().default(null),
  lastTriggerAt: z.string().nullable().default(null),
});
export type OrchestratorRuntime = z.infer<typeof orchestratorRuntimeSchema>;
export const ORCHESTRATOR_LOG_LIMIT = 100;
export const orchestratorLogEntrySchema = z.object({
  at: z.string(),
  level: z.enum(["info", "warn", "error"]),
  text: z.string(),
  taskId: z.string().nullable().default(null),
  agentId: z.string().nullable().default(null),
});
export type OrchestratorLogEntry = z.infer<typeof orchestratorLogEntrySchema>;
/** Computed on each snapshot for the panel. */
export const orchestratorStatusSchema = z.object({
  active: z.boolean(),
  running: z.number(),
  waiting: z.number(),
  /** CUSTOM(task-checkpoints): its tasks between checkpoints; they hold no slot. */
  paused: z.number().default(0),
  nextRunAt: z.string().nullable(),
  /**
   * CUSTOM(resource-pools): why waiting tasks don't start although the orchestrator would take
   * them now and has room.
   */
  hold: orchestratorHoldSchema.nullable().default(null),
});
export type { OrchestratorHold };
/** What the reviewer did with a Done task's work: commit, a PR description, a merge. */
export const finishSchema = z.object({
  running: z.enum(["commit", "pr", "merge"]).nullable().default(null),
  committedAt: z.string().nullable().default(null),
  mergedAt: z.string().nullable().default(null),
  /** CUSTOM(packages): the merge commit in the base branch, the package bisect's pivot. */
  mergeCommit: z.string().nullable().default(null),
  prTitle: z.string().nullable().default(null),
  prBody: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});
export type Finish = z.infer<typeof finishSchema>;
export const FINISH_STEPS = ["commit", "pr", "merge"] as const;
export type FinishStep = (typeof FINISH_STEPS)[number];
/** A chat with an agent that refines a draft before it is ready to start. */
export const refinementSchema = z.object({
  agentId: z.string(),
  status: z.enum(["chatting", "writing", "written", "failed"]),
  updatedAt: z.string(),
  error: z.string().nullable().default(null),
});
export type Refinement = z.infer<typeof refinementSchema>;
export const cardOrderByStageSchema = z
  .record(z.string(), z.array(z.string()))
  .default({});
export type CardOrderByStage = z.infer<typeof cardOrderByStageSchema>;
export const dataSchema = z
  .object({
    schemaVersion: z.literal(DATA_SCHEMA_VERSION).default(DATA_SCHEMA_VERSION),
    revision: z.number().int().nonnegative().default(0),
    /** CUSTOM(task-numbers): the next short ticket number; it only moves forward. */
    nextTaskNumber: z.number().int().min(1).default(1),
    serverId: z.string().nullable().default(null),
    settings: settingsSchema.default(() => settingsSchema.parse({})),
    // Timestamp owns a native pin; null respects manual intervention for this stage.
    autoPins: z.record(z.string(), z.string().nullable()).default({}),
    tasks: z.array(taskSchema).default([]),
    cardOrderByStage: cardOrderByStageSchema,
    orchestrator: orchestratorSchema.default(() =>
      orchestratorSchema.parse({}),
    ),
    orchestrations: z.record(z.string(), orchestrationSchema).default({}),
    refinements: z.record(z.string(), refinementSchema).default({}),
    orchestrators: z.array(orchestratorConfigSchema).default([]),
    orchestratorRuntime: z
      .record(z.string(), orchestratorRuntimeSchema)
      .default({}),
    orchestratorLogs: z
      .record(z.string(), z.array(orchestratorLogEntrySchema))
      .default({}),
    /** Set once the default orchestrator was created, so deleting it sticks. */
    defaultOrchestratorSeeded: z.boolean().default(false),
    finishes: z.record(z.string(), finishSchema).default({}),
    // CUSTOM(projects-assistant): delivery policy, per-task delivery state and attempts.
    assistant: assistantDataSchema.default(() => assistantDataSchema.parse({})),
    // CUSTOM(night-tasks)
    night: nightSettingsSchema.default(() => nightSettingsSchema.parse({})),
    nightRuntime: nightRuntimeSchema.default(() =>
      nightRuntimeSchema.parse({}),
    ),
    // CUSTOM(packages)
    packages: z.array(packageSchema).default([]),
    packageRuns: z.array(packageRunSchema).default([]),
  })
  .superRefine((data, context) => {
    const ids = new Set<string>();
    const workspaces = new Set<string>();
    for (const task of data.tasks) {
      if (
        ids.has(task.id) ||
        (task.workspaceId !== null && workspaces.has(task.workspaceId))
      )
        context.addIssue({
          code: "custom",
          message: "Duplicate task or workspace identity",
        });
      ids.add(task.id);
      if (task.workspaceId) workspaces.add(task.workspaceId);
      if (
        task.binding?.workspaceId &&
        task.binding.workspaceId !== task.workspaceId
      )
        context.addIssue({
          code: "custom",
          message: "Binding workspace identity mismatch",
        });
    }
  });
export type Data = z.infer<typeof dataSchema>;
export const activitySchema = z.enum([
  "idle",
  "running",
  "waiting",
  "attention",
  "error",
]);
export const pinStateSchema = z
  .enum(["none", "automatic", "manual"])
  .default("none");
export const cardSchema = taskSchema.extend({
  stage: z.union([stageSchema, z.literal("conflict")]),
  labels: z.array(z.string()),
  managedLabels: z.array(z.string()),
  changeRequest: z
    .object({
      forge: z.string(),
      number: z.number().nullable(),
      url: z.string(),
      title: z.string(),
      state: z.enum(["open", "draft", "merged", "closed", "unknown"]),
      checksStatus: z
        .enum(["none", "pending", "success", "failure"])
        .nullable(),
      reviewDecision: z
        .enum(["approved", "changes_requested", "pending"])
        .nullable(),
    })
    .nullable(),
  changeRequestUnavailable: z.boolean(),
  activity: activitySchema,
  pinState: pinStateSchema,
  /** CUSTOM(orchestrator-in-place): runs in the project folder; no worktree to merge. */
  inPlace: z.boolean().default(false),
  dueAt: z.string().nullable(),
  agents: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      activity: activitySchema,
      archived: z.boolean(),
    }),
  ),
});
export type Card = z.infer<typeof cardSchema>;
export const boardSchema = z.object({
  revision: z.number(),
  serverId: z.string(),
  version: z.string(),
  connected: z.boolean(),
  error: z.string().nullable(),
  refreshedAt: z.string().nullable(),
  settings: settingsSchema,
  cards: z.array(cardSchema),
  cardOrderByStage: cardOrderByStageSchema,
  orchestrator: orchestratorSchema.default(() => orchestratorSchema.parse({})),
  orchestrations: z.record(z.string(), orchestrationSchema).default({}),
  refinements: z.record(z.string(), refinementSchema).default({}),
  orchestrators: z.array(orchestratorConfigSchema).default([]),
  orchestratorRuntime: z
    .record(z.string(), orchestratorRuntimeSchema)
    .default({}),
  orchestratorLogs: z
    .record(z.string(), z.array(orchestratorLogEntrySchema))
    .default({}),
  orchestratorStatus: z
    .record(z.string(), orchestratorStatusSchema)
    .default({}),
  finishes: z.record(z.string(), finishSchema).default({}),
  /** CUSTOM(task-checkpoints): each long task's checklist and checkpoint log, by task id. */
  progress: z.record(z.string(), taskProgressSchema).default({}),
  // CUSTOM(night-tasks)
  night: nightSettingsSchema.default(() => nightSettingsSchema.parse({})),
  nightRuntime: nightRuntimeSchema.default(() => nightRuntimeSchema.parse({})),
  nightStatus: z
    .object({
      open: z.boolean(),
      /** Next time the window opens; null while it is open. */
      nextStartAt: z.string().nullable(),
      /** Night tasks waiting in Scheduled. */
      waiting: z.number(),
    })
    .default({ open: false, nextStartAt: null, waiting: 0 }),
  // CUSTOM(packages): the open and closed packages with their counts and last gate run.
  packages: z.array(packageViewSchema).default([]),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      directory: z.string(),
      isGit: z.boolean(),
      // CUSTOM(project-icon-colors): the accent pair resolved from the project's icon.
      accent: projectAccentSchema.nullable().optional(),
    }),
  ),
});
export type Board = z.infer<typeof boardSchema>;

export function newTask(
  id: string,
  title: string,
  now: string,
  stage = "backlog",
  number = 0,
): Task {
  return {
    id,
    number,
    title,
    description: "",
    workspaceId: null,
    projectId: null,
    projectName: "",
    createdAt: now,
    updatedAt: now,
    draftStage: stage,
    lastStage: stage,
    lastConversationAt: null,
    conversationStatus: "none",
    conversationDisplayEvidence: "none",
    conversationGateAt: null,
    conversationGateEvidence: "unknown",
    conversationReason: null,
    conversationAgents: [],
    mergedDrafts: [],
    issue: null,
    archived: null,
    orchestratorId: null,
    timing: null,
    packageId: null,
    testTier: null,
    binding: null,
  };
}

/** A saved column order leads; newly discovered cards retain their activity order at the tail. */
export function cardsForStage(
  cards: readonly Card[],
  stage: Stage,
  orders: CardOrderByStage = {},
): Card[] {
  const saved = Object.hasOwn(orders, stage) ? orders[stage] : [];
  const ranks = new Map(saved.map((id, index) => [id, index]));
  const activityTime = (card: Card) => {
    const value =
      card.workspaceId === null ? card.updatedAt : card.lastConversationAt;
    return value === null ? -Infinity : Date.parse(value);
  };
  return cards
    .filter(
      (card) =>
        card.stage === stage &&
        card.archived?.status !== "archived" &&
        card.archived?.status !== "external",
    )
    .sort(
      (left, right) =>
        (ranks.get(left.id) ?? Infinity) - (ranks.get(right.id) ?? Infinity) ||
        activityTime(right) - activityTime(left) ||
        left.id.localeCompare(right.id),
    );
}

// CUSTOM(hidden-board-agents): every agent the board starts (orchestrator runs, reviews, auto-fixes)
// carries this label. The app keeps them out of the sidebar and never notifies for them; the
// Project Manager reports on them instead. Same string as BOARD_AGENT_LABEL in
// packages/protocol/src/board-agents.ts (the plugin builds against a pinned client).
export const BOARD_AGENT_LABEL = "paseo.board-agent";
export const BOARD_AGENT_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    [BOARD_AGENT_LABEL]: "true",
  });
// CUSTOM(sidebar-agent-tabs): the app's Tasks sidebar lists the refinement chat under
// Orchestrators. Same string as REFINEMENT_CHAT_LABEL in packages/protocol/src/board-agents.ts
// (the plugin builds against a pinned client).
export const REFINEMENT_CHAT_LABEL = "pwb/refinement-chat";
