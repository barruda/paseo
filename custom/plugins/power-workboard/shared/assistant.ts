// CUSTOM(projects-assistant): the Projects Assistant decides what happens to a task's work when its
// agent's turn ends (merge, prepare a PR, tell the user, or nothing), keeps a history, and feeds the
// Projects Dashboard and Projects Conversations surfaces. This file is the contract shared by the
// server engine, the two client surfaces, and the app's Settings page
// (packages/app/src/screens/settings/bruno-customizations/projects-assistant-page.tsx mirrors the
// settings schemas). Ideas taken from deepseek-ai/dsh-superagent: a structured report instead of
// reading free text, an observe mode, delivery owned by the assistant and not by the task's agent.
import { z } from "zod";
import { skillSelectionSchema } from "./profiles";
import { orchestratorHoldSchema } from "./hold"; // CUSTOM(resource-pools)

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

/** CUSTOM(assistant-compact): the chat restarts with a summary once its context reaches this. */
export const DEFAULT_COMPACT_AT_TOKENS = 180_000;
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
  /**
   * CUSTOM(assistant-compact): once a turn leaves the chat's context at this many tokens or more,
   * the board restarts the chat with a short summary of the recent conversation. 0 turns it off.
   */
  compactAtTokens: z
    .number()
    .int()
    .min(0)
    .max(10_000_000)
    .default(DEFAULT_COMPACT_AT_TOKENS),
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
  // CUSTOM(task-checkpoints): the task is not finished; the engine commits and resumes it later.
  "checkpoint",
] as const;
/** CUSTOM(task-checkpoints): a long task's checklist, as the agent reports it at a checkpoint. */
export const progressSchema = z.object({
  done: z.array(z.string().max(1000)).max(200).default([]),
  next: z.array(z.string().max(1000)).max(200).default([]),
});
export type Progress = z.infer<typeof progressSchema>;
// CUSTOM(assistant-cards): structured questions and the review map, inspired by jelly's "agents
// show, people react" (docs/assistant-reply-protocol.md, "The task report"). Every new field is
// optional and a malformed one falls back to its default, so a report never fails over them.
/** One answer to the report's question: what it gains and what it costs. */
export const reportOptionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(500),
  gains: z.string().max(1000).nullable().default(null).catch(null),
  costs: z.string().max(1000).nullable().default(null).catch(null),
});
export type ReportOption = z.infer<typeof reportOptionSchema>;
/** How an outcome was checked: watched it work, a named test, or not at all. */
export const EVIDENCE_KINDS = ["seen", "tested", "unverified"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
/** One thing the user asked for, quoted, and the evidence that it works. */
export const reportOutcomeSchema = z.object({
  ask: z.string().trim().min(1).max(2000),
  evidence: z.enum(EVIDENCE_KINDS).catch("unverified"),
  /** The command and what it showed, or the test's name. */
  detail: z.string().max(2000).nullable().default(null).catch(null),
});
export type ReportOutcome = z.infer<typeof reportOutcomeSchema>;
/** `outside`: changed without being asked. */
export const NOT_DONE_KINDS = ["skipped", "unverified", "outside"] as const;
export type NotDoneKind = (typeof NOT_DONE_KINDS)[number];
export const notDoneSchema = z.object({
  kind: z.enum(NOT_DONE_KINDS).catch("skipped"),
  text: z.string().trim().min(1).max(2000),
});
export type NotDone = z.infer<typeof notDoneSchema>;
/** Keeps the valid items of a list and drops the rest, so one bad item does not empty it. */
function lenientList<T extends z.ZodTypeAny>(item: T, max: number) {
  return z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((values) =>
      values
        .map((value) => item.safeParse(value))
        .filter((result) => result.success)
        .map((result) => result.data as z.output<T>)
        .slice(0, max),
    );
}

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
  /** CUSTOM(task-checkpoints): for `checkpoint`: what is done and what comes next. */
  progress: progressSchema.nullable().default(null),
  /** CUSTOM(task-checkpoints): for `checkpoint`: resume no sooner than this ISO 8601 time. */
  resumeAfter: z.string().max(100).nullable().default(null),
  /** CUSTOM(task-checkpoints): for `checkpoint`: what the task waits for, such as "CI". */
  waitingFor: z.string().max(500).nullable().default(null),
  /** CUSTOM(assistant-cards): answers to `question`, each with its gains and costs. */
  options: lenientList(reportOptionSchema, 8),
  /** CUSTOM(assistant-cards): the option id the agent recommends, and why. */
  recommend: z.string().max(40).nullable().default(null).catch(null),
  why: z.string().max(2000).nullable().default(null).catch(null),
  /** CUSTOM(assistant-cards): one per thing the user asked for, with its evidence. */
  outcomes: lenientList(reportOutcomeSchema, 50),
  /** CUSTOM(assistant-cards): what was skipped, left unverified, or changed outside the ask. */
  notDone: lenientList(notDoneSchema, 50),
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
  "checkpoint", // CUSTOM(task-checkpoints)
  // CUSTOM(resource-pools): a queued fix dropped before it reached the agent.
  "dropped",
  "usage-limit", // CUSTOM(usage-limit): the agent stopped on the plan's usage limit
] as const;
export const attemptSchema = z.object({
  index: z.number().int().min(1),
  agentId: z.string().nullable(),
  orchestratorId: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
  outcome: z.enum(ATTEMPT_OUTCOMES).default("running"),
  /** What started this attempt after the first: the reviewer's feedback or the failed check. */
  // CUSTOM(task-checkpoints): `checkpoint` resumes the task after a checkpoint report.
  // CUSTOM(usage-limit): `usage-limit` resumes it after the plan's usage limit reset.
  trigger: z
    .enum(["start", "feedback", "auto-fix", "checkpoint", "usage-limit"])
    .default("start"),
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
  // CUSTOM(task-checkpoints): too many checkpoints, or checkpoints that complete nothing new.
  "stalled",
  // CUSTOM(resource-pools): a fix has waited FIX_WAIT_LIMIT_MS for a pool slot; it still goes when one frees.
  "fix-waiting",
  // CUSTOM(usage-limit): the agent hit the usage limit again after MAX_LIMIT_PAUSES resumes.
  "usage-limit",
  // CUSTOM(unattended-automation): an automatic agent has waited too long on a permission.
  "permission",
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
   * CUSTOM(resource-pools): a fix (failed check or merge conflict) waiting for a free slot in its
   * pool. The delivery is in `fixing`, or in `needs-you` with reason `fix-waiting` once it waited
   * FIX_WAIT_LIMIT_MS; the next pass with room sends `prompt`. `since`: when it was queued
   * (absent on fixes queued before it existed). `hold`: why it waits, for the UI to translate.
   */
  queuedFix: z
    .object({
      prompt: z.string(),
      reason: z.enum(["verify-failed", "merge-conflict"]),
      since: z.string().optional(),
      hold: orchestratorHoldSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
  /**
   * CUSTOM(assistant-wake): when the chat agent was told this task waits for it; absent or
   * null means not yet. Each entry to needs-you clears it; a new Workboard (plugin reload,
   * daemon restart) tells the chat about every needs-you task still without it.
   */
  toldAt: z.string().nullable().optional(),
  /**
   * CUSTOM(assistant-wake): the first `toldAt` of this wait. A quick message or a steer rewrites
   * `toldAt`; a `reportedAt` from before that rewrite still counts as handling the task.
   */
  firstToldAt: z.string().nullable().optional(),
  /**
   * CUSTOM(assistant-wake): when the assistant last recorded an action on this task with
   * board_report. A task left waiting past NEEDS_YOU_REMIND_MS without it is told again once.
   */
  reportedAt: z.string().nullable().optional(),
  /** CUSTOM(assistant-wake): when the one reminder for a task still waiting was sent. */
  remindedAt: z.string().nullable().optional(),
  startedAt: z.string(),
  updatedAt: z.string(),
});
export type Delivery = z.infer<typeof deliverySchema>;
/** CUSTOM(resource-pools): how long a fix waits for a pool slot before it goes to needs-you. */
export const FIX_WAIT_LIMIT_MS = 30 * 60_000;

/**
 * CUSTOM(task-checkpoints): a long task's progress across checkpoints. `checkpoints` counts the
 * automatic resumes since the task started or the reviewer last sent it back; `stalls` counts the
 * checkpoints in a row that completed no new item.
 */
export const CHECKPOINT_LOG_LIMIT = 20;
export const taskProgressSchema = z.object({
  done: z.array(z.string()).default([]),
  next: z.array(z.string()).default([]),
  checkpoints: z.number().int().min(0).default(0),
  stalls: z.number().int().min(0).default(0),
  /** The agent's summary at the last checkpoint, for the handoff to a new agent. */
  summary: z.string().max(20000).nullable().default(null),
  /** Oldest first, at most CHECKPOINT_LOG_LIMIT. */
  log: z
    .array(
      z.object({
        at: z.string(),
        checkpoint: z.number().int(),
        text: z.string().max(2000),
      }),
    )
    .default([]),
  updatedAt: z.string(),
});
export type TaskProgress = z.infer<typeof taskProgressSchema>;
/** Checkpoints in a row with no new done item before the task goes to the user. */
export const STALL_LIMIT = 2;

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
  /** CUSTOM(task-checkpoints): keyed by task id. */
  progress: z.record(z.string(), taskProgressSchema).default({}),
  /**
   * CUSTOM(usage-limit): the chat hit the usage limit on a wake; the next wake waits until this
   * time. Null: wake as usual. It belongs to the chat agent that hit the limit (`wakeAgentId`):
   * a chat the user replaced does not inherit its wait.
   */
  wakeAt: z.string().nullable().default(null),
  /**
   * CUSTOM(usage-limit): the chat agent `wakeAt` belongs to. Null: unknown (data from before this
   * field existed), so `wakeAt` holds whichever chat is current. A `wakeTurn` is scoped by its own
   * `agentId`.
   */
  wakeAgentId: z.string().nullable().default(null),
  /**
   * CUSTOM(usage-limit): the last wake sent, until its turn ends. If that turn ends on the usage
   * limit, its tasks lose `toldAt` and are told again at `wakeAt`. Its `agentId` scopes it: a turn
   * of a chat the user replaced is not read as the current chat's.
   */
  wakeTurn: z
    .object({
      agentId: z.string(),
      toldAt: z.string(),
      taskIds: z.array(z.string()),
    })
    .nullable()
    .default(null),
  /**
   * CUSTOM(assistant-compact): the chat the last automatic compaction started. `bornTokens` is
   * its context after its first turn (null until measured); a chat born at or above the limit is
   * never compacted again, so a summary too big for the limit cannot loop.
   */
  compact: z
    .object({
      agentId: z.string(),
      fromAgentId: z.string(),
      fromTokens: z.number(),
      at: z.string(),
      bornTokens: z.number().nullable().default(null),
    })
    .nullable()
    .default(null),
  /**
   * CUSTOM(assistant-compact): a compaction failed; the next one waits until this time. Cleared
   * by a compaction that works and by any new chat the user opens.
   */
  compactRetryAt: z.string().nullable().default(null),
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
  "checkpoint", // CUSTOM(task-checkpoints)
  "usage-limit", // CUSTOM(usage-limit): a task or the chat paused by the plan's usage limit
  "verify-passed",
  "verify-failed",
  "fix-requested",
  "waiting-clean",
  "committed",
  "merged",
  "pr-prepared",
  "needs-you",
  "told-assistant",
  "chat-compacted", // CUSTOM(assistant-compact): the chat restarted with a summary
  "chat-compact-failed", // CUSTOM(assistant-compact): a compaction failed; it waits COMPACT_RETRY_MS
  "observed",
  "failed",
  "done",
  "dismissed",
] as const;
/**
 * CUSTOM(assistant-compact): the history files events about the chat itself (not a task) under
 * this id, so the Reports page lists them as one row.
 */
export const CHAT_HISTORY_TASK_ID = "assistant-chat";
export const historyEventKindSchema = z.enum(HISTORY_EVENT_KINDS);
export type HistoryEventKind = z.infer<typeof historyEventKindSchema>;

/**
 * CUSTOM(assistant-cards): who caused a history event. `user`: the user, from the board or a card;
 * `assistant`: the Projects Assistant chat, through its board tools; `orchestrator`: the board's
 * own engine (orchestrators, delivery, the chat's housekeeping).
 */
export const HISTORY_ACTORS = ["user", "assistant", "orchestrator"] as const;
export const historyActorSchema = z.enum(HISTORY_ACTORS);
export type HistoryActor = z.infer<typeof historyActorSchema>;

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
  /** CUSTOM(assistant-cards): null on events written before the field existed. */
  by: historyActorSchema.nullable().default(null),
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
  /** CUSTOM(resource-pools): for `fix-waiting`: why the fix still waits. */
  hold: orchestratorHoldSchema.nullable().optional(),
});
export type NeedsYouItem = z.infer<typeof needsYouItemSchema>;

export const runningItemSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  projectName: z.string(),
  orchestratorName: z.string().nullable(),
  agentId: z.string().nullable(),
  /**
   * `running` while the agent works; otherwise the delivery stage. CUSTOM(task-checkpoints):
   * `waiting` is a task between checkpoints; it holds no slot.
   */
  stage: z.union([
    z.literal("running"),
    z.literal("waiting"),
    deliveryStageSchema,
  ]),
  attempt: z.number().int().nullable(),
  startedAt: z.string(),
  /** CUSTOM(task-checkpoints): for `waiting`: when it resumes (null: on the next pass). */
  resumeAt: z.string().nullable().optional(),
  /** CUSTOM(usage-limit): for `waiting`: paused by the usage limit, not by a checkpoint. */
  limited: z.boolean().optional(),
  waitingFor: z.string().nullable().optional(),
  /** CUSTOM(task-checkpoints): items done, items in all, and checkpoints so far. */
  progress: z
    .object({
      done: z.number().int(),
      total: z.number().int(),
      checkpoints: z.number().int(),
    })
    .nullable()
    .optional(),
  /** CUSTOM(resource-pools): for `fixing`: why the fix waits for a pool slot. */
  hold: orchestratorHoldSchema.nullable().optional(),
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
  /**
   * CUSTOM(assistant-cards): an answer from a report card: an option picked in one tap, or
   * feedback on one outcome or step. A board task waiting for the user continues with it as its
   * feedback (like Continue task); any other agent gets it as a message. With `question`, the
   * task's current question must still be that one.
   */
  z.object({
    type: z.literal("answer"),
    agentId: z.string().min(1),
    text: z.string().trim().min(1).max(20000),
    question: z.string().max(5000).nullable().default(null),
  }),
  /** A message from the user to one of the managed agents. */
  z.object({
    type: z.literal("send"),
    agentId: z.string(),
    text: z.string().min(1).max(20000),
  }),
]);
export type AssistantActionInput = z.infer<typeof assistantActionInputSchema>;
