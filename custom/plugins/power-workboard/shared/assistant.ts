// CUSTOM(projects-assistant): the Projects Assistant decides what happens to a task's work when its
// agent's turn ends (merge, prepare a PR, tell the user, or nothing), keeps a history, and feeds the
// Projects Dashboard and Projects Conversations surfaces. This file is the contract shared by the
// server engine, the two client surfaces, and the app's Settings page
// (packages/app/src/screens/settings/bruno-customizations/projects-assistant-page.tsx mirrors the
// settings schemas). Ideas taken from deepseek-ai/dsh-superagent: a structured report instead of
// reading free text, an observe mode, delivery owned by the assistant and not by the task's agent.
import { z } from "zod";
import { skillSelectionSchema } from "./profiles";

/**
 * What happens to a task's work when its agent finishes with a `done` report. `review` (the
 * default) hands the task to the assistant chat, which reviews it and merges it itself when the
 * change is low risk; `merge` merges with no review.
 */
export const ASSISTANT_ACTIONS = [
  "review",
  "merge",
  "prepare-pr",
  "notify",
  "nothing",
] as const;
export const assistantActionSchema = z.enum(ASSISTANT_ACTIONS);
export type AssistantAction = z.infer<typeof assistantActionSchema>;

/** Merge is never a default: it only runs in a project where the user picked it. Review is. */
export const ASSISTANT_DEFAULT_ACTIONS = [
  "review",
  "prepare-pr",
  "notify",
  "nothing",
] as const;
export const assistantDefaultActionSchema = z.enum(ASSISTANT_DEFAULT_ACTIONS);

export const projectPolicySchema = z.object({
  action: assistantActionSchema.default("review"),
  /** Record what the action would do, without doing it. */
  observe: z.boolean().default(false),
  /** Optional shell command run in the task's worktree before a merge; empty skips the check. */
  verifyCommand: z.string().max(2000).default(""),
  /** How many times a failed check goes back to the same agent before the user is told. */
  autoFixes: z.number().int().min(0).max(3).default(1),
  /** Branch the merge targets; empty means the project checkout's current branch. */
  baseBranch: z.string().max(200).default(""),
});
export type ProjectPolicy = z.infer<typeof projectPolicySchema>;

// CUSTOM(assistant-review-policy): who reviews a project's finished task before it is merged.
// `self`: the assistant reviews the diff itself. `fresh-agent`: a new agent, not the author, reviews
// it through a review task. A project without an entry is `self`. The assistant still raises a big or
// risky change to `fresh-agent` by judgment; nothing runs the review automatically.
export const REVIEW_POLICIES = ["self", "fresh-agent"] as const;
export const reviewPolicySchema = z.enum(REVIEW_POLICIES);
export type ReviewPolicy = z.infer<typeof reviewPolicySchema>;
export const DEFAULT_REVIEW_POLICY: ReviewPolicy = "self";

/**
 * Settings stored before the field existed get these on load (a zod default only fills a missing
 * field, so it runs once): DreamMMO and DreamMMO-android are the critical projects.
 */
export const SEEDED_REVIEW_POLICIES: Readonly<Record<string, ReviewPolicy>> = {
  prj_1b497e9066c32377: "fresh-agent", // DreamMMO
  prj_dc85fecbbf8a290e: "fresh-agent", // DreamMMO-android
};

/** The project's review policy; `self` when it has none. */
export function reviewPolicyFor(
  settings: Pick<AssistantSettings, "reviews">,
  projectId: string | null | undefined,
): ReviewPolicy {
  return (projectId && settings.reviews[projectId]) || DEFAULT_REVIEW_POLICY;
}

/** The agent behind the Projects Assistant chat (a real Paseo agent with board tools). */
export const assistantChatSettingsSchema = z.object({
  /** `provider/model`. */
  provider: z.string().trim().min(3).default("claude/claude-opus-5-5"),
  thinkingOptionId: z.string().trim().min(1).nullable().default("high"),
  /** It only uses the board's tools and runs in an empty folder, so it doesn't stop to ask. */
  modeId: z.string().trim().min(1).nullable().default("bypassPermissions"),
  // CUSTOM(agent-profiles): the assistant's profile settings; its content is in the profile folder.
  skills: skillSelectionSchema.default(() => skillSelectionSchema.parse({})),
  memory: z.boolean().default(true),
  /** CUSTOM(assistant-wake): tell the chat agent, in a batch, when a task needs the user. */
  wakeOnNeedsYou: z.boolean().default(true),
});
export type AssistantChatSettings = z.infer<typeof assistantChatSettingsSchema>;

export const assistantSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** For projects with no policy of their own. */
  defaultAction: assistantDefaultActionSchema.default("review"),
  /** Keyed by project id. */
  projects: z.record(z.string(), projectPolicySchema).default({}),
  /** CUSTOM(assistant-review-policy): keyed by project id; kept apart from `projects` so setting
   * the review does not give a project its own delivery rule. */
  reviews: z
    .record(z.string(), reviewPolicySchema)
    .default(() => ({ ...SEEDED_REVIEW_POLICIES })),
  chat: assistantChatSettingsSchema.default(() =>
    assistantChatSettingsSchema.parse({}),
  ),
});
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;

/**
 * What a task's agent ends its turn with, as JSON inside `<report>...</report>`. Read only from
 * this block; the assistant never guesses the status from prose.
 */
export const REPORT_STATUSES = [
  "done",
  "blocked",
  "needs_input",
  "failed",
] as const;
export const reportSchema = z.object({
  status: z.enum(REPORT_STATUSES),
  summary: z.string().max(20000),
  filesChanged: z.array(z.string().max(1000)).max(500).default([]),
  checks: z
    .array(z.object({ command: z.string().max(2000), passed: z.boolean() }))
    .max(50)
    .default([]),
  risks: z.array(z.string().max(2000)).max(50).default([]),
  /** For `needs_input` and `blocked`: what the user has to answer or do. */
  question: z.string().max(5000).nullable().default(null),
});
export type Report = z.infer<typeof reportSchema>;

/** One run of an agent on a task: the first start, and each continuation after feedback or a failed check. */
export const ATTEMPT_OUTCOMES = [
  "running",
  "done",
  "blocked",
  "needs_input",
  "failed",
  "no-report",
  "agent-error",
] as const;
export const attemptSchema = z.object({
  index: z.number().int().min(1),
  agentId: z.string().nullable(),
  orchestratorId: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
  outcome: z.enum(ATTEMPT_OUTCOMES).default("running"),
  /** What started this attempt after the first: the reviewer's feedback or the failed check. */
  trigger: z.enum(["start", "feedback", "auto-fix"]).default("start"),
  feedback: z.string().max(20000).nullable().default(null),
  /** How many times the engine told this attempt's agent to continue after it stopped with an error. */
  retries: z.number().int().min(0).default(0),
});
export type Attempt = z.infer<typeof attemptSchema>;

/** Why a task is waiting on the user. */
export const NEEDS_YOU_REASONS = [
  "review",
  "notify",
  "observed",
  "no-report",
  "blocked",
  "needs-input",
  "failed",
  "agent-error",
  "verify-failed",
  "merge-conflict",
  "dirty-checkout",
  "merge-error",
  "pr-error",
  "dependency-files",
] as const;
export const needsYouReasonSchema = z.enum(NEEDS_YOU_REASONS);
export type NeedsYouReason = z.infer<typeof needsYouReasonSchema>;

/**
 * Where a finished task is in delivery. Persisted after every step, so a daemon restart resumes
 * at the step it was in; every step is safe to repeat.
 */
export const DELIVERY_STAGES = [
  "reported",
  "verifying",
  "fixing",
  "committing",
  "merging",
  "preparing-pr",
  "delivered",
  "needs-you",
  "dismissed",
] as const;
export const deliveryStageSchema = z.enum(DELIVERY_STAGES);
export type DeliveryStage = z.infer<typeof deliveryStageSchema>;

export const deliverySchema = z.object({
  stage: deliveryStageSchema,
  /** The action in force when the delivery started (project policy, or the default). */
  action: assistantActionSchema,
  observe: z.boolean().default(false),
  attempt: z.number().int().min(1),
  report: reportSchema.nullable().default(null),
  reason: needsYouReasonSchema.nullable().default(null),
  /** Short human detail for the reason, such as a git error. */
  detail: z.string().max(5000).nullable().default(null),
  /** Tail of the verify command's output. */
  verifyOutput: z.string().max(20000).nullable().default(null),
  fixesUsed: z.number().int().min(0).default(0),
  /** CUSTOM(assistant-autonomy): times a merge conflict went back to the task's agent. */
  conflictFixes: z.number().int().min(0).default(0),
  /** CUSTOM(assistant-autonomy): times the merge waited for the base checkout to be clean. */
  dirtyRetries: z.number().int().min(0).default(0),
  /**
   * CUSTOM(assistant-wake): when the chat agent was told this task waits for it; absent or
   * null means not yet. Each entry to needs-you clears it; a new Workboard (plugin reload,
   * daemon restart) tells the chat about every needs-you task still without it.
   */
  toldAt: z.string().nullable().optional(),
  startedAt: z.string(),
  updatedAt: z.string(),
});
export type Delivery = z.infer<typeof deliverySchema>;

/** Stored inside the board's data (`dataSchema.assistant`). */
export const assistantDataSchema = z.object({
  settings: assistantSettingsSchema.default(() =>
    assistantSettingsSchema.parse({}),
  ),
  /** Keyed by task id. */
  deliveries: z.record(z.string(), deliverySchema).default({}),
  /** Keyed by task id, oldest first. */
  attempts: z.record(z.string(), z.array(attemptSchema)).default({}),
  /** The current Projects Assistant chat agent; a new conversation replaces it. */
  chatAgentId: z.string().nullable().default(null),
});
export type AssistantData = z.infer<typeof assistantDataSchema>;

/** Append-only history, one JSON object per line under `plugin-data/power-workboard/history/`. */
export const HISTORY_EVENT_KINDS = [
  // CUSTOM(assistant-reports): created and moved by the user or the assistant, for the Reports page.
  "task-created",
  "task-moved",
  "task-started",
  "task-continued",
  "report",
  "verify-passed",
  "verify-failed",
  "fix-requested",
  "waiting-clean",
  "committed",
  "merged",
  "pr-prepared",
  "needs-you",
  "told-assistant",
  "observed",
  "failed",
  "done",
  "dismissed",
] as const;
export const historyEventKindSchema = z.enum(HISTORY_EVENT_KINDS);
export type HistoryEventKind = z.infer<typeof historyEventKindSchema>;

export const historyEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: historyEventKindSchema,
  taskId: z.string(),
  taskTitle: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string(),
  orchestratorId: z.string().nullable(),
  orchestratorName: z.string().nullable(),
  agentId: z.string().nullable(),
  attempt: z.number().int().nullable(),
  action: assistantActionSchema.nullable(),
  reason: needsYouReasonSchema.nullable().default(null),
  /** One line a person can read in the history table. */
  text: z.string().max(2000),
  detail: z.string().max(5000).nullable().default(null),
});
export type HistoryEvent = z.infer<typeof historyEventSchema>;

export const HISTORY_RETENTION_DAYS = 90;

export const assistantProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  directory: z.string(),
  isGit: z.boolean(),
});
export type AssistantProject = z.infer<typeof assistantProjectSchema>;

export const needsYouItemSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string(),
  orchestratorId: z.string().nullable(),
  orchestratorName: z.string().nullable(),
  agentId: z.string().nullable(),
  reason: needsYouReasonSchema,
  detail: z.string().nullable(),
  report: reportSchema.nullable(),
  attempt: z.number().int().nullable(),
  since: z.string(),
  /** A git project whose work can be merged now. */
  canMerge: z.boolean(),
});
export type NeedsYouItem = z.infer<typeof needsYouItemSchema>;

export const runningItemSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  projectName: z.string(),
  orchestratorName: z.string().nullable(),
  agentId: z.string().nullable(),
  /** `running` while the agent works; otherwise the delivery stage. */
  stage: z.union([z.literal("running"), deliveryStageSchema]),
  attempt: z.number().int().nullable(),
  startedAt: z.string(),
});
export type RunningItem = z.infer<typeof runningItemSchema>;

export const overviewSchema = z.object({
  enabled: z.boolean(),
  needsYou: z.array(needsYouItemSchema),
  running: z.array(runningItemSchema),
  queued: z.number().int(),
});
export type Overview = z.infer<typeof overviewSchema>;

const countsSchema = z.object({
  done: z.number().int(),
  merged: z.number().int(),
  failed: z.number().int(),
  needsYou: z.number().int(),
});
export const statsSchema = z.object({
  days: z.number().int(),
  totals: z.object({
    doneToday: z.number().int(),
    doneInPeriod: z.number().int(),
    mergedInPeriod: z.number().int(),
    /** Share of finished tasks done on their first attempt, 0..1; null with no data. */
    firstTryRate: z.number().nullable(),
    averageAttempts: z.number().nullable(),
    averageDurationMs: z.number().nullable(),
    running: z.number().int(),
    queued: z.number().int(),
    needsYou: z.number().int(),
  }),
  /** One row per local day, oldest first, `date` as YYYY-MM-DD. */
  perDay: z.array(countsSchema.extend({ date: z.string() })),
  perProject: z.array(
    countsSchema.extend({
      projectId: z.string().nullable(),
      projectName: z.string(),
    }),
  ),
  perOrchestrator: z.array(
    countsSchema.extend({
      orchestratorId: z.string().nullable(),
      name: z.string(),
    }),
  ),
});
export type Stats = z.infer<typeof statsSchema>;

/** The Projects Conversations tree: orchestrator → task → the agents it started (no subagents). */
export const treeAgentSchema = z.object({
  agentId: z.string(),
  title: z.string().nullable(),
  /** Paseo's activity, or `gone` when the agent no longer exists. */
  status: z.string(),
  attempt: z.number().int().nullable(),
  current: z.boolean(),
});
export const treeTaskSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  projectName: z.string(),
  /** Board column label. */
  column: z.string(),
  deliveryStage: deliveryStageSchema.nullable(),
  updatedAt: z.string(),
  agents: z.array(treeAgentSchema),
});
export const treeOrchestratorSchema = z.object({
  /** null groups tasks started by hand (Start work) rather than by an orchestrator. */
  id: z.string().nullable(),
  name: z.string(),
  projectName: z.string().nullable(),
  active: z.boolean(),
  tasks: z.array(treeTaskSchema),
});
export const treeSchema = z.object({
  orchestrators: z.array(treeOrchestratorSchema),
});
export type Tree = z.infer<typeof treeSchema>;

export const conversationItemSchema = z.object({
  id: z.string(),
  at: z.string().nullable(),
  kind: z.enum(["user", "assistant", "tool", "thought", "system"]),
  text: z.string(),
  toolName: z.string().nullable().default(null),
  toolStatus: z.string().nullable().default(null),
});
export type ConversationItem = z.infer<typeof conversationItemSchema>;

export const conversationCursorSchema = z.object({
  epoch: z.string(),
  seq: z.number().int(),
});

export const conversationSchema = z.object({
  agentId: z.string(),
  title: z.string().nullable(),
  status: z.string(),
  /** Oldest first. */
  items: z.array(conversationItemSchema),
  hasOlder: z.boolean(),
  /** Pass back as `before` to read older items. */
  cursor: conversationCursorSchema.nullable(),
  taskId: z.string().nullable(),
  report: reportSchema.nullable(),
  attempts: z.array(attemptSchema),
  /** The orchestrator's log lines about this task, newest first. */
  log: z.array(
    z.object({
      at: z.string(),
      level: z.enum(["info", "warn", "error"]),
      text: z.string(),
    }),
  ),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const assistantActionInputSchema = z.discriminatedUnion("type", [
  /** Commit and merge now, whatever the project's policy says. */
  z.object({ type: z.literal("merge-now"), taskId: z.string() }),
  z.object({ type: z.literal("prepare-pr"), taskId: z.string() }),
  /** Send the task back to its agent with feedback (like the board's Continue task). */
  z.object({
    type: z.literal("continue"),
    taskId: z.string(),
    feedback: z.string().max(20000),
  }),
  /** Move the task to Done, like the board's Done. */
  z.object({ type: z.literal("mark-done"), taskId: z.string() }),
  /** Take it off Needs you; the task stays where it is on the board. */
  z.object({ type: z.literal("dismiss"), taskId: z.string() }),
  /** A message from the user to one of the managed agents. */
  z.object({
    type: z.literal("send"),
    agentId: z.string(),
    text: z.string().min(1).max(20000),
  }),
]);
export type AssistantActionInput = z.infer<typeof assistantActionInputSchema>;
