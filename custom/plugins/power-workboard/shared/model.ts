import { z } from "zod";
import { scheduleSchema } from "./schedule";

export const STAGES = [
  "inbox",
  "todo",
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
// Power Workboard uses its own labels, so it never takes over the original Workboard's columns.
export const DEFAULT_LABELS: Record<StageKind, string> = {
  inbox: "pwb:inbox",
  todo: "pwb:backlog",
  ready: "pwb:ready",
  "in-progress": "pwb:in-progress",
  review: "pwb:review",
  done: "pwb:done",
  canceled: "pwb:canceled",
};
export const STAGE_COLORS = {
  inbox: "indigo",
  todo: "sky",
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
  ready: "Ready to start",
  "in-progress": "In progress",
  review: "Ready to review",
  done: "Done",
};
export const DEFAULT_GROUPS: Group[] = (
  ["todo", "ready", "in-progress", "review", "done"] as const
).map((kind) => ({
  id: kind === "todo" ? "backlog" : kind,
  kind,
  name: DEFAULT_GROUP_NAMES[kind] ?? null,
  label: DEFAULT_LABELS[kind],
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
const preferences = {
  autoArchive: z.boolean().default(false),
  archiveMappingNeedsReview: z.boolean().default(false),
  archiveAfterDays: z.number().int().min(1).max(365).default(30),
  defaultDraftGroup: stageSchema.nullable().default(null),
  defaultStartGroup: stageSchema.nullable().default(null),
  defaultStartWorkGroup: stageSchema.nullable().default(null),
  pinInProgressWorkspaces: z.boolean().default(true),
};
export const settingsSchema = z.object({
  ...preferences,
  groups: groupsSchema.default(DEFAULT_GROUPS),
  groupOrder: groupOrderSchema.default([]),
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
    now > Date.parse(due)
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
export const DATA_SCHEMA_VERSION = 8;

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
export const taskSchema = z.object({
  id: z.string(),
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
  status: z.enum(["starting", "running", "finished", "failed", "queued"]),
  workspaceId: z.string().nullable().default(null),
  agentId: z.string().nullable().default(null),
  startedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
  sawRunning: z.boolean().default(false),
  error: z.string().nullable().default(null),
  /** The agent's last reply when it finished, shown to the reviewer. */
  summary: z.string().nullable().default(null),
  /** What the reviewer asked for when they sent the task back to Ready to start. */
  feedback: z.string().nullable().default(null),
  /** The orchestrator that started it; its log and limits own this run. */
  orchestratorId: z.string().nullable().default(null),
});
export type Orchestration = z.infer<typeof orchestrationSchema>;
/** Agent settings new orchestrators start from; refinement chats use them too. */
export const orchestratorSchema = z.object({
  /** Provider and model in `provider/model` format. */
  provider: z.string().trim().min(3).default("claude/claude-opus-5-5"),
  modeId: z.string().trim().min(1).nullable().default("bypassPermissions"),
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
  /** Off: its schedule does not fire; Run now still works. */
  enabled: z.boolean().default(true),
  schedule: scheduleSchema.default({ kind: "manual" }),
  maxConcurrent: z.number().int().min(1).max(10).default(2),
  /** Tasks one run (Run now or a daily time) takes in all. */
  batchSize: z.number().int().min(1).max(50).default(5),
  provider: z.string().trim().min(3).default("claude/claude-opus-5-5"),
  modeId: z.string().trim().min(1).nullable().default("bypassPermissions"),
  thinkingOptionId: z.string().trim().min(1).nullable().default("medium"),
  useWorktree: z.boolean().default(true),
  instructions: z.string().max(20000).default(""),
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
  nextRunAt: z.string().nullable(),
});
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
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      directory: z.string(),
      isGit: z.boolean(),
    }),
  ),
});
export type Board = z.infer<typeof boardSchema>;

export function newTask(
  id: string,
  title: string,
  now: string,
  stage = "backlog",
): Task {
  return {
    id,
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
