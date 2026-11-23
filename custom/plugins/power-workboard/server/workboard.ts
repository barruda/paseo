import { deskStatusOf, type DeskStatus } from "../shared/desk-status";
import { taskNumberLabel } from "../shared/task-reference"; // CUSTOM(delete-task)
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  archiveDueAt,
  archiveGate,
  cardsForStage,
  conversationStatusFor,
  defaultGroup,
  defaultWorkspaceGroup,
  defaultStartWorkGroup,
  groupKind,
  isArchiveDue,
  isDraftGroup,
  isTerminalGroup,
  labelKey,
  finishSchema,
  nightSettingsSchema,
  NIGHT_LOG_LIMIT,
  packageRunSchema,
  packageSchema,
  PACKAGE_OUTPUT_LIMIT,
  PACKAGE_RUN_LIMIT,
  testTierOverrideSchema,
  orchestratorConfigSchema,
  orchestratorSchema,
  providerModelSchema, // CUSTOM(bulk-orchestrator-agent)
  newTask,
  orderedGroups,
  resolveStage,
  settingsSchema,
  statusLabels,
  DEFAULT_GROUPS,
  STAGE_COLORS,
  type Board,
  type Card,
  type Data,
  type Finish,
  type FinishStep,
  type Orchestration,
  type OrchestratorConfig,
  type OrchestratorHold, // CUSTOM(resource-pools)
  type OrchestratorRuntime,
  type Package,
  type PackageRun,
  type PackageTrigger,
  type Pool, // CUSTOM(resource-pools)
  type ProjectAccent, // CUSTOM(project-icon-colors)
  type ProjectIconData, // CUSTOM(project-icon-colors)
  ORCHESTRATOR_LOG_LIMIT,
  type Refinement,
  type ConversationAgent,
  type ConversationDisplay,
  type ConversationGate,
  type ConversationReason,
  type Settings,
  type Stage,
  type StartInput,
  type Task,
  type TaskTiming,
  BOARD_AGENT_LABELS, // CUSTOM(hidden-board-agents)
  BOARD_AGENT_LABEL, // CUSTOM(hidden-board-agents)
  REFINEMENT_CHAT_LABEL, // CUSTOM(sidebar-agent-tabs)
  TMP_CLEANUP_INTERVAL_MS, // CUSTOM(unattended-automation)
} from "../shared/model";
import {
  newPmCard,
  normalizePmRecommend,
  pmAnswerOption,
  pmBreakerCandidate,
  pmNeedsAnswerToDecide,
  PM_CARD_ID_PREFIX,
  PM_CARD_LIMIT,
  trimPmCards,
  type PmCard,
  type PmCardCreateInput,
  type PmCardUpdateInput,
  type PmDecider,
} from "../shared/pm-board"; // CUSTOM(pm-board)
import {
  buildReplyTaskStates,
  type ReplyTaskState,
} from "../shared/reply-task-sync"; // CUSTOM(pm-chat-task-sync)
import { cleanupScratchDirectory, tmpCleanupDue } from "./tmp-cleanup"; // CUSTOM(unattended-automation)
import { runsUnattended } from "../shared/permission"; // CUSTOM(unattended-automation)
import {
  dueTrigger,
  nextRunAt,
  nightSchedule,
  openWindowStart,
  windowOpen,
} from "../shared/schedule";
import {
  defaultNightSystem,
  SHUTDOWN_WARNING_MS,
  type NightSystem,
} from "./night"; // CUSTOM(night-tasks)
import { CANCEL_BINDING_BUSY_ERROR_CODE, type Mutation } from "../shared/rpc";
// CUSTOM(projects-assistant)
import {
  deliverySchema,
  attemptSchema,
  projectPolicySchema,
  assistantSettingsSchema,
  DEFAULT_WAKE_DELAY_SECONDS, // CUSTOM(assistant-wake)
  type AssistantActionInput,
  type Attempt,
  type Delivery,
  type HistoryEventKind,
  type HistoryActor, // CUSTOM(assistant-cards)
  type NeedsYouReason,
  type ProjectPolicy,
  type AssistantSettings,
  // CUSTOM(task-checkpoints)
  CHECKPOINT_LOG_LIMIT,
  STALL_LIMIT,
  taskProgressSchema,
  type Report,
  FIX_WAIT_LIMIT_MS, // CUSTOM(resource-pools)
  CHAT_HISTORY_TASK_ID, // CUSTOM(assistant-compact)
} from "../shared/assistant";
import { worktreeBaseName } from "./assistant/task-git";
import {
  effectiveTestTier,
  missingGateEnv,
  nextPackageColor,
  packageViews,
  resolvePackageGate,
  riskyPaths,
  testSectionFor,
} from "../shared/packages"; // CUSTOM(packages)
import {
  GATE_TIMEOUT_MS,
  changedPaths,
  defaultGateDirectory,
  removeGateWorktree,
  runPackageGate,
} from "./package-gate"; // CUSTOM(packages)
import { packageGitOps, type PackageGitOps } from "./package-git"; // CUSTOM(packages)
import { parseReport } from "./assistant/report";
import {
  ASSISTANT_SEED_PROMPT,
  CHAT_INSTRUCTIONS,
  CHAT_LABEL,
  defaultChatDirectory,
} from "./assistant/chat";
// CUSTOM(assistant-compact)
import {
  COMPACT_QUESTION,
  compactPrompt,
  recentExchange,
} from "./assistant/compact";
import { mkdir } from "node:fs/promises";
// CUSTOM(resource-pools)
import {
  freeRamPercent,
  readMemory,
  type MemoryReader,
  type MemoryReading,
} from "./resources";
// CUSTOM(agent-profiles)
import { ASSISTANT_PROFILE, type SkillSelection } from "../shared/profiles";
import {
  Profiles,
  buildAgentProfile,
  defaultProfilesDirectory,
  type AgentProfile,
  type ProfileRef,
} from "./profiles";
import { listSkills } from "./profile-skills";
import {
  KeyedLock,
  classifyMergeError,
  dependencyRefusal,
  isUpToDate,
  runVerify,
  type VerifyRunner,
  inPlaceCommitMessage, // CUSTOM(orchestrator-in-place)
  inPlaceCommitPlan, // CUSTOM(orchestrator-in-place)
} from "./assistant/delivery";
import type { HistoryEventInput, HistoryStore } from "./assistant/history";
import type { ReportStore } from "./assistant/reports"; // CUSTOM(factory)
// CUSTOM(factory)
import {
  compiledWorkerConfigHash,
  workerConfigHash,
  type RevisionStamp,
} from "./factory/stamp";
import {
  FactoryIds,
  missingFactoryIds,
  moveOffUnknownColumns,
  workerOf,
  type AppliedFactory,
  type ColumnMove,
} from "../shared/factory/active";
import type { FactoryMode } from "../shared/factory/status";
import { legacyPipelineFor } from "../shared/factory/builtin-pipelines"; // CUSTOM(factory)
import {
  BUILTIN_SPEC_PROMPT,
  BUILTIN_SPEC_TEMPLATE,
} from "../shared/factory/builtin-spec"; // CUSTOM(factory)
import {
  PIPELINE_CHOICE_RULE,
  autonomyForProject,
  chooseCandidates,
  enterStage,
  findStage,
  loopContinued,
  pipelineForProject,
  refineSpecStage,
  reviewRework,
  stageChip,
  stageExit,
  stageSection,
  startPipeline,
  type TaskPipeline,
} from "../shared/factory/engine";
import { projectWorkers, stageRunner } from "../shared/factory/pipeline";
import {
  DEFAULT_AUTONOMY,
  PM_DECIDES_TEXT,
  approvedMergeRefusal,
  autonomyBreakerMs,
  autonomyProjectRule,
  breakerWakeText,
  mergeNeedsUser,
  userOnlyRefusal,
  type AutonomyPresetId,
  type UserOnlyReason,
} from "../shared/autonomy";
import type {
  CompiledPipeline,
  CompiledStage,
} from "../shared/factory/compile";
import type { ViewSource } from "./assistant/views";
import {
  checkpointResumePrompt, // CUSTOM(task-checkpoints)
  continuationPrompt,
  conflictPrompt,
  handoffSection, // CUSTOM(task-checkpoints)
  fixPrompt,
  orchestratorPrompt,
  type Ticket, // CUSTOM(task-description-files)
  parseTicket,
  pullRequestPrompt,
  specChatPrompt,
  stageRunPrompt, // CUSTOM(factory)
  usageLimitResumePrompt, // CUSTOM(usage-limit)
  writeTicketPrompt,
} from "./orchestrator";
import { MAX_LIMIT_PAUSES, usageLimitResumeAt } from "../shared/usage-limit"; // CUSTOM(usage-limit)
import { AGENT_REPLACES_LABEL } from "../shared/reply-protocol"; // CUSTOM(assistant-compact-follow)
import type {
  Agent,
  ConversationEvidence,
  Host,
  Inventory,
  Workspace,
} from "./host";
import type { Store } from "./store";

// CUSTOM(projects-assistant): what the engine needs from the history and the outside world.
export interface AssistantOptions {
  history?: Pick<HistoryStore, "append">;
  /** CUSTOM(factory): the PM's board_report entries; pm_card_create reads reviews from them (#165). */
  reports?: Pick<ReportStore, "since">;
  verify?: VerifyRunner;
  /** Waits before each "Continue the task where you stopped." after an agent error. */
  retryDelaysMs?: number[];
  /** Folder the chat agent works in; defaults to the plugin-data folder. */
  chatDirectory?: string;
  /** CUSTOM(agent-profiles): where the profiles live; defaults to the plugin-data folder. */
  profilesDirectory?: string;
  /** CUSTOM(assistant-wake): quiet time before the chat agent is told about tasks that need the user. */
  wakeDelayMs?: number;
  /** CUSTOM(assistant-wake): wait between looks at a chat that still reads busy after its turn ended. */
  reloadRetryMs?: number;
  /** CUSTOM(night-tasks): notifications and the power-off command. */
  night?: NightSystem;
  /** CUSTOM(assistant-autonomy): wait before retrying a merge blocked by a dirty base checkout. */
  dirtyRetryMs?: number;
  /** CUSTOM(resource-pools): reads the free RAM for the pools' floor; tests pass a fake. */
  memory?: MemoryReader;
  /** CUSTOM(assistant-compact): quiet time after the chat's last change before its size is checked. */
  compactSettleMs?: number;
  /** CUSTOM(orchestrator-in-place): wait before retrying a commit held by another task in the folder. */
  folderRetryMs?: number;
  /** CUSTOM(packages): the gate runner and the risk scan; tests inject fakes. */
  packageGate?: typeof runPackageGate;
  changedPaths?: typeof changedPaths;
  /** CUSTOM(packages): the branch primitives; tests inject a fake so no git runs. */
  packageGit?: PackageGitOps;
  /** CUSTOM(assistant-compact): a quick message to this chat still waits for its answer. */
  chatQueued?: (agentId: string) => boolean;
  /** CUSTOM(restart-resume): the restart script's skip file; tests point it elsewhere. */
  restartStateFile?: string;
  /** CUSTOM(factory): the factory's mode and, in active mode, the config it applies. */
  factory?: FactoryAccess;
}

/** CUSTOM(factory): what the board reads of the factory (server/factory/shadow.ts). */
export interface FactoryAccess {
  mode(): FactoryMode;
  /** The compiled factory active mode applies; null in other modes or before one compiles. */
  applied(): AppliedFactory | null;
  /** Active mode: resolves once the first load is done. */
  ready(): Promise<void>;
  /** Follows the setting now: a new mode applies (or stops applying) the factory at once. */
  sync(): void;
  /** Active mode: replaces the prompt (the body) of a factory `worker.md`, by root-relative path. */
  writePrompt(file: string, text: string): Promise<void>;
}

/**
 * CUSTOM(factory): a user's config edit. In active mode the store writes it to the factory
 * (server/factory/shadow.ts `factoryStoreView`); otherwise it is a plain save.
 */
const CONFIG_EDIT = { factory: true } as const;
/** CUSTOM(factory): a gate's Decisões card needs one of its options. */
export const GATE_OPTION_REQUIRED_ERROR =
  "Pick one of the gate's options: each one names the stage the task goes to";
/** CUSTOM(factory): the Project Manager may not answer a pipeline gate. */
export const GATE_USER_ONLY_ERROR =
  "Only the user answers a pipeline gate, in Decisões";
/** CUSTOM(factory): archiving an open gate's card would leave its task with no way forward. */
export const GATE_ARCHIVE_ERROR =
  "This card holds an open pipeline gate; answer it instead of archiving it";
/**
 * The last line of a board wake. CUSTOM(factory): what is the user's comes from each task's
 * autonomy preset, which its Needs you line names (ticket 12).
 */
export const WAKE_INSTRUCTIONS = `Handle each one as your instructions say: review and merge-now (reason review), send feedback with continue, answer the agent's question or give the ok yourself when you can do it with reasonable precision and no real risk, fix small reversible blockers, and settle each pipeline choice with board_pipeline_advance or board_pipeline_ask. Leave to the user only what each line's autonomy gives them; everything else is yours: ${PM_DECIDES_TEXT}. ${PIPELINE_CHOICE_RULE} Then tell the user in 2-4 lines, in the language they write to you in, what you did and what is left for them (or that nothing is).`;
/** CUSTOM(factory): the note on a gate's Decisões proposal archived when active mode turns off. */
export const GATE_CLOSED_NOTE =
  "Closed without an answer: factory active mode was turned off, so this gate no longer moves the task. Continue or Done on the task works as today.";
/** Longest agent title the board sets. */
const AGENT_TITLE_MAX = 200;
/**
 * The refinement chat's agent name. The kind goes last so the agent list still reads by task
 * title; the title is cut first so a long one keeps the suffix.
 */
export function refinementChatTitle(title: string): string {
  const suffix = " · refine";
  return `${title.slice(0, AGENT_TITLE_MAX - suffix.length).trimEnd()}${suffix}`;
}
/**
 * CUSTOM(night-tasks): a power-off arms only this soon after the night was last active (its
 * window open or a night task running), so turning the option on by day never powers off.
 */
const NIGHT_SHUTDOWN_GRACE_MS = 15 * 60_000;
function checkTiming(timing: TaskTiming | null): TaskTiming | null {
  if (timing?.kind !== "at") return timing;
  const at = Date.parse(timing.at);
  if (!Number.isFinite(at)) throw new Error("Choose a valid start time");
  return { kind: "at", at: new Date(at).toISOString() };
}
type AttemptOutcome = Attempt["outcome"]; // CUSTOM(projects-assistant)
// CUSTOM(task-checkpoints): for tasks started by hand, with no orchestrator setting.
const DEFAULT_MAX_CHECKPOINTS = 5;
/** CUSTOM(task-checkpoints): a checkpoint never waits longer than this. */
const MAX_RESUME_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
/** CUSTOM(board-turn-end): an agent must stay idle this long before the board calls the turn over. */
const IDLE_SETTLE_MS = 20_000;
/**
 * CUSTOM(restart-resume): what a task agent hears when a daemon restart cut its turn. The last
 * sentence stops an agent that was restarting Paseo from doing it again in a loop.
 */
const RESTART_RESUME_MESSAGE =
  "The Paseo daemon restarted and cut your last turn. Continue from where you stopped. The restart was intentional: do not restart it again.";
/** CUSTOM(restart-resume): after a resume, a turn this long to start before the board settles it. */
const RESTART_RESUME_GRACE_MS = 90_000;
/**
 * CUSTOM(restart-resume): the skip file the restart script writes counts for this daemon start
 * only. A start more than this far from the file's timestamp is another restart, not that one.
 */
const RESTART_SKIP_WINDOW_MS = 15 * 60_000;
/** CUSTOM(restart-resume): the script's skip file, unless a test points elsewhere. */
function defaultRestartSkipFile(): string {
  return join(
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
    "paseo-restart-skip.json",
  );
}
/** CUSTOM(assistant-wake): how soon to look again while the chat is busy with another turn. */
const BUSY_WAKE_RETRY_MS = 10_000;
/** CUSTOM(assistant-wake): a deferred reload looks again this often, this many times, while the chat ends its turn. */
const RELOAD_RETRY_MS = 1_000;
const RELOAD_RETRIES = 10;
/** CUSTOM(assistant-wake): a task told and left waiting this long is told again once. */
const NEEDS_YOU_REMIND_MS = 10 * 60_000;
/** CUSTOM(assistant-wake): a user message re-steers the Needs you list when it is this old. */
const CHAT_TURN_REMIND_MS = 60_000;
// CUSTOM(unattended-automation): within ~2 minutes, plus a tick, an automatic agent stuck on
// a permission reaches Needs you.
const PERMISSION_WAIT_MS = 90_000;
const DEFAULT_RETRY_DELAYS_MS = [30_000, 60_000, 120_000];
/** CUSTOM(usage-limit): a wake's turn is read no sooner than this after the send, so it has started. */
const WAKE_TURN_START_MS = 30_000;
/**
 * CUSTOM(assistant-compact): the chat must stay quiet this long after its last `agent_update` before
 * the board compacts it, so a message the app queued during the turn goes out first.
 */
const COMPACT_SETTLE_MS = 15_000;
/** CUSTOM(assistant-compact): after a failed compaction, the next try waits this long. */
const COMPACT_RETRY_MS = 30 * 60_000;
/**
 * CUSTOM(assistant-compact): a chat this compaction started is compacted again only after it grew
 * by this share of the limit, so a chat born just under the limit does not restart every turn.
 */
const COMPACT_MIN_GROWTH = 0.1;
/** CUSTOM(assistant-autonomy): how many times a merge waits for a clean base checkout. */
const MAX_DIRTY_RETRIES = 12;
/**
 * CUSTOM(resource-pools): after an agent of a pool with a RAM floor starts, nothing else of the
 * pool starts for this long. The agent opens Unity (10-17 GB) minutes after it starts, so a RAM
 * reading taken right after a start would still let the next task in.
 */
export const RAM_SETTLE_MS = 5 * 60_000;
/** CUSTOM(resource-pools): delivery stages that keep the task's pool slot for a fix. */
const POOL_RESERVING_STAGES: ReadonlySet<string> = new Set([
  "verifying",
  "committing",
  "merging",
  "fixing",
]);
/**
 * CUSTOM(night-tasks): a night task that still keeps the night power-off waiting: running, or
 * (CUSTOM(task-checkpoints)) queued or waiting to resume after a checkpoint.
 */
function nightBusy(record: Orchestration): boolean {
  return (
    record.status === "starting" ||
    record.status === "running" ||
    (record.checkpoint &&
      (record.status === "queued" || record.status === "waiting"))
  );
}
const DELIVERY_STEPS: ReadonlySet<string> = new Set([
  "verifying",
  "committing",
  "merging",
  "preparing-pr",
]);

/** CUSTOM(resource-pools): a pool hold in one line, for the orchestrator's log and delivery details. */
function holdText(hold: OrchestratorHold): string {
  if (hold.kind === "folder")
    return `Waiting: "${hold.taskTitle ?? "another task"}" is not delivered yet in ${hold.directory}`;
  if (hold.kind === "pool")
    return `Waiting: pool "${hold.poolName}" is full (${hold.running}/${hold.maxConcurrent})`;
  if (hold.kind === "settle")
    return `Waiting for RAM to settle: pool "${hold.poolName}" started an agent less than ${RAM_SETTLE_MS / 60_000} minutes ago`;
  return `Waiting for RAM: ${hold.freeRamPercent}% free, pool "${hold.poolName}" needs ${hold.minFreeRamPercent}%`;
}
/** CUSTOM(resource-pools): a queued fix still waits: in `fixing`, or on Needs you because it waited too long. */
function fixWaits(delivery: Delivery | undefined): boolean {
  return (
    !!delivery?.queuedFix &&
    (delivery.stage === "fixing" ||
      (delivery.stage === "needs-you" && delivery.reason === "fix-waiting"))
  );
}
/** One workspace's combined conversation evidence. */
interface WorkspaceConversation {
  displayAt: string | null;
  display: ConversationDisplay;
  gateAt: string | null;
  gate: ConversationGate;
  reason: ConversationReason | null;
  agents: ConversationAgent[];
}
/** Most severe first, so one reason is stored per task. */
const REASON_ORDER: ConversationReason[] = [
  "timeline-unreadable",
  "child-enumeration-unavailable",
  "child-timeline-unreadable",
  "replay-timestamp",
  "truncated-window",
];

const labelsEqual = (a: string[], b: string[]) =>
  JSON.stringify(a.map(labelKey).sort()) ===
  JSON.stringify(b.map(labelKey).sort());
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const sameOrder = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);
const hidden = (task: Task) =>
  task.archived?.status === "archived" || task.archived?.status === "external";

function projectChangeRequest(workspace?: Workspace): Card["changeRequest"] {
  const runtime = workspace?.githubRuntime;
  const request = runtime?.pullRequest;
  if (!request) return null;
  const nativeState = request.state.toLowerCase();
  const state =
    request.isMerged || nativeState === "merged"
      ? "merged"
      : nativeState === "closed"
        ? "closed"
        : nativeState === "open" || nativeState === "opened"
          ? request.isDraft
            ? "draft"
            : "open"
          : "unknown";
  return {
    forge: workspace?.forge ?? "github",
    number: request.number ?? null,
    url: request.url,
    title: request.title,
    state,
    checksStatus: request.checksStatus ?? null,
    reviewDecision: request.reviewDecision ?? null,
  };
}

/** One writer per plugin process. UI windows never own timers or archive operations. */
/**
 * CUSTOM(assistant-cards): a report's question with its options, for the Ready to review card's
 * one-tap answers and the `answer` check. Null when the report asks nothing with options.
 */
function askOf(report: Report | null): Orchestration["ask"] {
  return report?.question && report.options.length
    ? {
        question: report.question,
        options: report.options,
        recommend: report.recommend,
        why: report.why,
      }
    : null;
}

export class Workboard {
  private inventory: Inventory = { workspaces: [], agents: [], projects: [] };
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  // CUSTOM(unattended-automation): the hourly scratch-folder pass.
  private tmpCleanupRanAt: number | null = null;
  private tmpCleanupRunning = false;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<void> | undefined;
  // null means a full refresh; undefined means no work is waiting.
  private pendingRefresh: Set<string> | null | undefined;
  private stopped = false;
  /** CUSTOM(board-turn-end): per finished task, since when its agent has been idle again. */
  private lateIdleSince = new Map<string, number>();
  /** CUSTOM(board-turn-end): the agent `updatedAt` whose reply was last re-read for a late report. */
  private lateChecked = new Map<string, string>();
  /** CUSTOM(board-turn-end): one pending refresh for when an idle settle window ends. */
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** CUSTOM(restart-resume): when the current daemon started; earlier activity was cut by it. */
  private restartCutoff = 0;
  /** CUSTOM(restart-resume): agents the restart script told the board to leave alone. */
  private restartSkipAgents = new Set<string>();
  private pendingMutations = 0;
  private connectionGeneration = 0;
  private epoch = 0;
  private workspaceEpochs = new Map<string, number>();
  private bindingInFlight = new Set<string>();
  private queuedStarts = new Map<string, number>();
  private archiveDeferrals = new Map<
    string,
    {
      reason: string;
      attempts: number;
      deferredUntil: number;
      fingerprint: string;
    }
  >();
  private connected = false;
  private error: string | null = "Workboard is starting";
  private refreshedAt: string | null = null;
  constructor(
    private host: Host,
    private store: Store,
    private now: () => number = Date.now,
    private interval = 60000,
    private assistantOptions: AssistantOptions = {}, // CUSTOM(projects-assistant)
  ) {}
  // CUSTOM(packages): the branch primitives, injectable in tests.
  private packageGitOps?: PackageGitOps;
  private get packageGit(): PackageGitOps {
    return (this.packageGitOps ??=
      this.assistantOptions.packageGit ?? packageGitOps());
  }
  // CUSTOM(agent-profiles)
  private profilesStore?: Profiles;
  private get profiles(): Profiles {
    return (this.profilesStore ??= new Profiles(
      this.assistantOptions.profilesDirectory ?? defaultProfilesDirectory(),
    ));
  }
  private profileRef(profile: string): ProfileRef {
    if (profile === ASSISTANT_PROFILE) {
      // CUSTOM(factory): active mode reads the Project Manager from the factory's pm/.
      const applied = this.factoryApplied();
      return {
        id: ASSISTANT_PROFILE,
        label: "Project Manager",
        seedPrompt: ASSISTANT_SEED_PROMPT,
        ...(applied
          ? {
              factory: {
                directory: join(applied.root, "pm"),
                pluginName: "pwb-assistant",
                systemPrompt: applied.compiled.pm.systemPrompt,
              },
            }
          : {}),
      };
    }
    return this.orchestratorProfileRef(this.orchestratorConfig(profile));
  }
  /** CUSTOM(factory): the factory's mode; "off" when the board runs without one (tests). */
  private factoryMode(): FactoryMode {
    return this.assistantOptions.factory?.mode() ?? "off";
  }
  private factoryApplied(): AppliedFactory | null {
    return this.assistantOptions.factory?.applied() ?? null;
  }
  /** CUSTOM(factory): the compiled worker an orchestrator runs in active mode. */
  private factoryWorker(orchestratorId: string) {
    const applied = this.factoryApplied();
    if (!applied) return null;
    const ids = new FactoryIds(
      this.store.peek((data) => data.factoryIds),
      applied.fileIds,
    );
    const worker = workerOf(applied, ids, orchestratorId);
    return worker ? { applied, worker } : null;
  }
  /** CUSTOM(factory): active mode reads an orchestrator's profile from `workers/<id>/`. */
  private orchestratorProfileRef(config: OrchestratorConfig): ProfileRef {
    const found = this.factoryWorker(config.id);
    if (!found) return { id: config.id, label: config.name };
    return {
      id: config.id,
      label: config.name,
      factory: {
        directory: join(found.applied.root, "workers", found.worker.id),
        pluginName: `pwb-${found.worker.id}`,
        systemPrompt: found.worker.systemPrompt,
      },
    };
  }
  /**
   * CUSTOM(factory): active mode with nothing compiled yet starts no task, so the board never runs
   * the JSON's config by mistake while the factory owns it.
   */
  private factoryHeld(): boolean {
    return this.factoryMode() === "active" && !this.factoryApplied();
  }
  /**
   * CUSTOM(factory): active mode loaded the factory. The ids `.factory-ids.json` adds go into the
   * runtime state, so tasks keep their worker even if the file goes away, and the board runs a pass
   * on the new config.
   */
  async factoryChanged(): Promise<void> {
    const applied = this.factoryApplied();
    if (applied) {
      const missing = missingFactoryIds(
        this.store.peek((data) => data.factoryIds),
        applied.fileIds,
      );
      if (missing)
        await this.serial(() =>
          this.store.update((data) => {
            Object.assign(data.factoryIds.workers, missing.workers);
            Object.assign(data.factoryIds.pools, missing.pools);
          }),
        );
    }
    this.changed();
  }
  async profileView(profile: string) {
    return this.profiles.read(this.profileRef(profile));
  }
  async setProfilePrompt(profile: string, text: string) {
    const ref = this.profileRef(profile);
    // CUSTOM(factory): active mode keeps the prompt in the body of the profile's worker.md.
    const applied = this.factoryApplied();
    if (ref.factory && applied)
      return this.assistantOptions.factory!.writePrompt(
        relative(applied.root, join(ref.factory.directory, "worker.md"))
          .split(sep)
          .join("/"),
        text,
      );
    return this.profiles.setSystemPrompt(ref, text);
  }
  async profileSkills(profile: string) {
    const { directory, pluginName } = await this.profiles.ensure(
      this.profileRef(profile),
    );
    return listSkills({ profileDirectory: directory, pluginName });
  }
  /**
   * The system prompt and provider options a new agent of this profile starts with. A profile
   * that cannot be read must not stop a task, so the agent then starts without one.
   */
  private async agentProfile(
    ref: ProfileRef,
    provider: string,
    skills: SkillSelection,
    memory: boolean,
  ): Promise<AgentProfile> {
    try {
      return buildAgentProfile({
        provider,
        profile: await this.profiles.read(ref),
        skills,
        memory,
      });
    } catch (error) {
      console.error(`Profile ${ref.id} could not be read:`, message(error));
      return {};
    }
  }
  private orchestratorProfile(config: OrchestratorConfig) {
    return this.agentProfile(
      this.orchestratorProfileRef(config), // CUSTOM(factory)
      config.provider,
      config.skills,
      config.memory,
    );
  }
  /**
   * CUSTOM(factory): the revision stamp of a new agent of this orchestrator. In active mode it is
   * the factory's revision, worker id and compiled hash; otherwise the hash comes from the live
   * config and the revision is null. An unreadable profile hashes as no system prompt, as the agent
   * then starts without one.
   */
  private async workerStamp(
    config: OrchestratorConfig,
  ): Promise<RevisionStamp> {
    const found = this.factoryWorker(config.id);
    if (found)
      return {
        factoryRevision: found.applied.revision,
        workerId: found.worker.id,
        workerConfigHash: compiledWorkerConfigHash(found.worker),
      };
    const systemPrompt = await this.profiles
      .read({ id: config.id, label: config.name })
      .then(
        (profile) => profile.systemPrompt,
        () => "",
      );
    return {
      factoryRevision: null,
      workerId: config.id,
      workerConfigHash: workerConfigHash({ config, systemPrompt }),
    };
  }
  // CUSTOM(projects-assistant)
  private delivering = new Set<string>();
  private retryAt = new Map<string, number>();
  private mergeLock = new KeyedLock();
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const work = this.queue.then(() => {
      if (this.stopped) throw new Error("Workboard stopped");
      return run();
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  private stamp(previous?: string): string {
    return new Date(
      Math.max(this.now(), previous ? Date.parse(previous) + 1 : 0),
    ).toISOString();
  }
  /** Only workspaces registered on this board are observed; the rest of the host is ignored. */
  private trackedWorkspaces(): Set<string> {
    const ids = new Set<string>();
    for (const task of this.store.current.tasks) {
      if (task.workspaceId) ids.add(task.workspaceId);
      if (task.binding?.workspaceId) ids.add(task.binding.workspaceId);
    }
    return ids;
  }
  private inventoryNow(): Promise<Inventory> {
    return this.host.inventory(this.trackedWorkspaces());
  }
  /** CUSTOM(task-description-files): a task's title and description, for a prompt. */
  private ticket(task: Pick<Task, "id" | "title">): Ticket {
    return { title: task.title, body: this.store.description(task.id) };
  }
  /** CUSTOM(task-description-files): the texts behind taskDescriptionsRpc. */
  taskDescriptions(taskIds: readonly string[]) {
    const wanted = new Set(taskIds);
    return this.store.current.tasks
      .filter((task) => wanted.has(task.id))
      .map((task) => ({
        taskId: task.id,
        revision: task.descriptionRevision,
        text: this.store.description(task.id),
      }));
  }
  private task(id: string): Task {
    const task = this.store.current.tasks.find((t) => t.id === id);
    if (!task) throw new Error("Task no longer exists");
    return task;
  }
  async start(): Promise<void> {
    await this.serial(async () => {
      // CUSTOM(restart-resume): only a daemon that reports its start gets the rule. Without it a
      // plugin reload could turn every idle task into an "interrupted" one.
      const daemonStartedAt = this.host.identity.startedAt;
      const daemonStart = daemonStartedAt ? Date.parse(daemonStartedAt) : NaN;
      this.restartCutoff = Number.isFinite(daemonStart) ? daemonStart : 0;
      await this.loadRestartSkip();
      await this.load();
      await this.store.update((data) => {
        for (const task of data.tasks)
          if (task.archived?.status === "pending") {
            task.archived.status = "uncertain";
            task.archived.detail =
              "Native archive outcome unknown after restart";
            task.issue = "native-archive-unknown";
          }
      });
      const bindings = this.store.current.tasks.filter((t) => t.binding);
      for (const task of bindings)
        this.bindingInFlight.add(task.binding!.operationId);
      for (const task of bindings) {
        try {
          await this.bind(task.id);
        } catch {
          await this.issue(task.id, "label-sync-incomplete");
        }
      }
      for (const task of bindings)
        this.bindingInFlight.delete(task.binding!.operationId);
      await this.reconcile();
      await this.scan();
      // CUSTOM(factory): active mode loads the factory (it needs the projects the scan read)
      // before the first orchestration, so no task starts on the JSON's config.
      await this.assistantOptions.factory?.ready();
      await this.orchestrate();
      this.chatId = this.store.current.assistant.chatAgentId; // CUSTOM(assistant-compact)
      this.requeueUntold(); // CUSTOM(assistant-wake)
      void this.checkWakeTurn(); // CUSTOM(usage-limit)
      // CUSTOM(projects-assistant): a delivery interrupted by a restart resumes at its step.
      for (const [taskId, delivery] of Object.entries(
        this.store.current.assistant.deliveries,
      ))
        if (DELIVERY_STEPS.has(delivery.stage)) this.launch(taskId);
    });
    // CUSTOM(unattended-automation): one background pass at start; the tick asks again hourly.
    void this.cleanTmpIfDue();
    if (!this.stopped)
      this.timer = setInterval(() => {
        void this.refresh().catch(() => undefined);
        void this.cleanTmpIfDue();
      }, this.interval);
  }
  /**
   * CUSTOM(unattended-automation): the scratch-folder cleanup, at most once an hour and never
   * inside the tick's serial queue. Settings are read on each pass so a change applies next hour.
   */
  private async cleanTmpIfDue(): Promise<void> {
    if (this.stopped || this.tmpCleanupRunning) return;
    const now = this.now();
    if (!tmpCleanupDue(this.tmpCleanupRanAt, now, TMP_CLEANUP_INTERVAL_MS))
      return;
    this.tmpCleanupRunning = true;
    this.tmpCleanupRanAt = now;
    try {
      const settings = this.store.current.settings.tmpCleanup;
      if (!settings.path) return;
      const result = await cleanupScratchDirectory({
        path: settings.path,
        maxAgeMs: settings.maxAgeHours * 60 * 60_000,
        now,
      });
      for (const error of result.errors) {
        console.error(`Scratch cleanup failed: ${error}`);
      }
    } catch (error) {
      console.error(
        "Scratch cleanup failed:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      this.tmpCleanupRunning = false;
    }
  }
  private async load() {
    await this.store.load();
    // CUSTOM(task-description-files): descriptions still in the JSON move to their files. If that
    // fails they stay in the JSON, still readable, and the next load tries again.
    if (this.store.hasLegacyDescriptions)
      try {
        await this.store.moveDescriptions();
      } catch (error) {
        console.error(
          "Moving task descriptions to files failed:",
          message(error),
        );
        await this.store.load();
      }
    // CUSTOM(task-records-jsonl): attempts and orchestrator logs still in the JSON move to their
    // JSONL files the same way.
    if (this.store.hasLegacyRecords)
      try {
        await this.store.moveRecords();
      } catch (error) {
        console.error(
          "Moving attempts and orchestrator logs to files failed:",
          message(error),
        );
        await this.store.load();
      }
    // CUSTOM(packages): a gate interrupted by a restart is not left running forever.
    if (this.store.current.packageRuns.some((run) => run.status === "running"))
      await this.store.update((data) => {
        for (const run of data.packageRuns)
          if (run.status === "running") {
            run.status = "error";
            run.finishedAt = this.stamp();
            run.output = `${run.output}\nInterrupted by a restart`
              .trim()
              .slice(-PACKAGE_OUTPUT_LIMIT);
          }
      });
    const serverId = this.store.current.serverId;
    if (serverId && serverId !== this.host.identity.serverId)
      throw new Error("Workboard storage belongs to another Paseo host");
    if (!serverId)
      await this.store.update((data) => {
        data.serverId = this.host.identity.serverId;
      });
    // A new board gets one orchestrator that is always on, so Ready to start just works.
    if (!this.store.current.defaultOrchestratorSeeded)
      await this.store.update((data) => {
        data.defaultOrchestratorSeeded = true;
        if (data.orchestrators.length) return;
        data.orchestrators.push(
          orchestratorConfigSchema.parse({
            ...data.orchestrator,
            id: randomUUID(),
            name: "Default",
            projectId: null,
            schedule: {
              kind: "window",
              days: [0, 1, 2, 3, 4, 5, 6],
              start: "00:00",
              end: "00:00",
            },
          }),
        );
      });
    // Boards saved before Ready to start existed get it right after their first To do group;
    // CUSTOM(night-tasks): Scheduled goes right before Ready to start.
    await this.addMissingGroup("ready");
    await this.addMissingGroup("scheduled");
  }
  private async addMissingGroup(kind: "ready" | "scheduled"): Promise<void> {
    const added = DEFAULT_GROUPS.find((group) => group.kind === kind)!;
    const groups = this.store.current.settings.groups;
    if (
      groups.some(
        (group) =>
          group.kind === kind ||
          group.id === added.id ||
          labelKey(group.label) === labelKey(added.label),
      )
    )
      return;
    await this.store.update((data) => {
      const settings = data.settings;
      const ordered = orderedGroups(settings);
      let at =
        kind === "scheduled"
          ? ordered.findIndex((group) => group.kind === "ready")
          : -1;
      if (at < 0) at = ordered.findIndex((group) => group.kind === "todo") + 1;
      const ids = ordered.map((group) => group.id);
      ids.splice(at, 0, added.id);
      settings.groups.push({ ...added });
      settings.groupOrder = ids;
    });
  }
  refresh(): Promise<void> {
    this.pendingRefresh = null;
    return this.flushRefresh();
  }
  private flushRefresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.serial(async () => {
      const scope = this.pendingRefresh ?? undefined;
      this.pendingRefresh = undefined;
      try {
        if (!this.connected) await this.load();
        await this.reconcile(scope);
        await this.scan(scope);
        await this.orchestrate();
        this.requeueUntold(); // CUSTOM(assistant-wake)
        void this.checkWakeTurn(); // CUSTOM(usage-limit)
        this.compactOnRefresh(); // CUSTOM(assistant-compact)
        void this.checkPmBreaker(); // CUSTOM(factory)
      } catch (error) {
        this.connected = false;
        this.error = message(error);
        throw error;
      }
    }).finally(() => {
      this.refreshing = undefined;
      if (this.pendingRefresh !== undefined) this.scheduleRefresh();
    });
    return this.refreshing;
  }
  private observation(id: string): string {
    return `${this.epoch}:${this.workspaceEpochs.get(id) ?? 0}`;
  }
  /**
   * CUSTOM(assistant-compact): an agent's snapshot changed (`agent_update`, which the board gets
   * for every agent). The chat is outside the board; its updates (turn end, new usage) arm the
   * size check.
   */
  agentUpdated(id: string): void {
    if (id === this.chatId) this.chatChanged();
  }
  agentChanged(id: string): void {
    this.agentUpdated(id); // CUSTOM(assistant-compact)
    // Streams of agents outside the board must not force a full refresh.
    const workspaceId = this.inventory.agents.find(
      (a) => a.id === id,
    )?.workspaceId;
    if (workspaceId) this.changed(workspaceId);
  }
  changed(workspaceId?: string): void {
    if (workspaceId && !this.trackedWorkspaces().has(workspaceId)) return;
    if (workspaceId)
      this.workspaceEpochs.set(
        workspaceId,
        (this.workspaceEpochs.get(workspaceId) ?? 0) + 1,
      );
    else this.epoch++;
    if (!workspaceId) this.pendingRefresh = null;
    else if (this.pendingRefresh !== null) {
      this.pendingRefresh ??= new Set();
      this.pendingRefresh.add(workspaceId);
    }
    this.scheduleRefresh();
  }
  /** CUSTOM(board-turn-end): re-run the tick once the idle settle window has passed. */
  private scheduleSettleCheck(): void {
    if (this.stopped || this.settleTimer) return;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      void this.refresh().catch(() => undefined);
    }, IDLE_SETTLE_MS + 1000);
  }
  private scheduleRefresh(): void {
    if (this.stopped || this.debounce || this.refreshing) return;
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      if (this.pendingRefresh !== undefined)
        void this.flushRefresh().catch(() => undefined);
    }, 300);
  }
  disconnected(reason = "Paseo disconnected"): void {
    this.epoch++;
    this.connectionGeneration++;
    this.connected = false;
    this.error = reason;
  }
  snapshot(data: Data = this.store.current): Board {
    return {
      revision: data.revision,
      ...this.host.identity,
      connected: this.connected,
      error: this.error,
      refreshedAt: this.refreshedAt,
      settings: data.settings,
      cardOrderByStage: data.cardOrderByStage,
      orchestrator: data.orchestrator,
      orchestrations: data.orchestrations,
      refinements: data.refinements,
      finishes: data.finishes,
      progress: data.assistant.progress, // CUSTOM(task-checkpoints)
      // CUSTOM(night-tasks)
      night: data.night,
      nightRuntime: data.nightRuntime,
      nightStatus: (() => {
        const schedule = nightSchedule(data.night);
        const open = windowOpen(schedule, this.now());
        const next = open ? null : nextRunAt(schedule, this.now());
        return {
          open,
          nextStartAt: next === null ? null : new Date(next).toISOString(),
          waiting: this.nightWaiting(data).length,
        };
      })(),
      orchestrators: data.orchestrators,
      orchestratorRuntime: data.orchestratorRuntime,
      orchestratorLogs: data.orchestratorLogs,
      orchestratorStatus: Object.fromEntries(
        data.orchestrators.map((o) => [o.id, this.orchestratorStatus(o, data)]),
      ),
      projects: this.inventory.projects,
      packages: packageViews(data, this.inventory.projects), // CUSTOM(packages)
      cards: data.tasks.map((task) => {
        const workspace = this.inventory.workspaces.find(
          (w) => w.id === task.workspaceId,
        );
        const agents = this.inventory.agents.filter(
          (a) => a.workspaceId === task.workspaceId,
        );
        const activities = agents
          .filter((a) => !a.archivedAt)
          .map((a) => a.activity);
        const activity: Card["activity"] =
          (["waiting", "error", "attention", "running"] as const).find((a) =>
            activities.includes(a),
          ) ?? "idle";
        const stage = this.taskStage(task, data, workspace);
        // CUSTOM(task-description-files): the snapshot carries no description.
        const { description: _description, ...fields } = task;
        return {
          ...fields,
          stage,
          labels: workspace?.labels ?? [],
          managedLabels: statusLabels(
            workspace?.labels ?? [],
            data.settings.groups,
          ),
          activity,
          inPlace: data.orchestrations[task.id]?.inPlace ?? false, // CUSTOM(orchestrator-in-place)
          // CUSTOM(factory): the pipeline stage, until the card reaches Done or Canceled.
          stageChip: isTerminalGroup(stage, data.settings.groups)
            ? null
            : this.stageChipOf(task),
          // CUSTOM(no-orchestrator-warning): a Ready to start task no enabled orchestrator takes.
          noOrchestrator:
            !task.archived &&
            groupKind(stage, data.settings.groups) === "ready" &&
            !this.taken(task, data),
          changeRequest: projectChangeRequest(workspace),
          changeRequestUnavailable: !!workspace?.githubRuntime?.error,
          pinState:
            workspace?.pinnedAt == null
              ? "none"
              : data.autoPins[workspace.id] === workspace.pinnedAt
                ? "automatic"
                : "manual",
          dueAt:
            task.workspaceId && isTerminalGroup(stage, data.settings.groups)
              ? archiveDueAt(archiveGate(task), data.settings.archiveAfterDays)
              : null,
          agents: agents.map((a) => ({
            id: a.id,
            title: a.title ?? a.id,
            activity: a.activity,
            archived: !!a.archivedAt,
          })),
        };
      }),
    };
  }
  private async reconcile(scope?: ReadonlySet<string>): Promise<void> {
    const connection = this.connectionGeneration;
    const inventory = await this.inventoryNow();
    await this.syncPins(inventory, connection);
    const prior = this.store.current;
    const observations = new Map<string, WorkspaceConversation>();
    for (const workspace of inventory.workspaces) {
      const agents = inventory.agents.filter(
        (agent) => agent.workspaceId === workspace.id,
      );
      const previous = prior.tasks.find(
        (task) => task.workspaceId === workspace.id,
      );
      if (scope && !scope.has(workspace.id) && previous) continue;
      if (previous && this.archiveDeferred(previous, workspace, agents))
        continue;
      const evidence = await this.observe(agents, previous, this.now());
      if (previous && this.archiveDeferrals.has(previous.id)) {
        if (evidence.gate === "unknown")
          await this.deferArchive(
            previous,
            "conversation-unknown",
            workspace,
            agents,
          );
        else if (
          !isArchiveDue(
            groupKind(
              resolveStage(
                workspace.labels,
                prior.settings.groups,
                prior.settings.defaultStartGroup,
              ),
              prior.settings.groups,
            ),
            evidence.gateAt,
            this.now(),
            prior.settings.archiveAfterDays,
          )
        )
          this.archiveDeferrals.delete(previous.id);
      }
      observations.set(workspace.id, evidence);
    }
    if (this.stopped) throw new Error("Workboard stopped");
    this.inventory = inventory;
    await this.store.update((data) => {
      for (const workspace of inventory.workspaces) {
        // Workspaces are never imported: only a task created here links one.
        const task = data.tasks.find((t) => t.workspaceId === workspace.id);
        if (!task) continue;
        if (task.archived?.status === "external") task.archived = null;
        task.title = workspace.name;
        task.projectId = workspace.projectId;
        task.projectName = workspace.projectDisplayName;
        task.lastStage = resolveStage(
          workspace.labels,
          data.settings.groups,
          data.settings.defaultStartGroup,
        );
        const observation = observations.get(workspace.id);
        if (observation) {
          task.lastConversationAt = observation.displayAt;
          task.conversationDisplayEvidence = observation.display;
          task.conversationStatus = conversationStatusFor(observation.display);
          task.conversationGateAt = observation.gateAt;
          task.conversationGateEvidence = observation.gate;
          task.conversationReason = observation.reason;
          task.conversationAgents = observation.agents;
        }
        task.issue =
          task.archived?.status === "uncertain"
            ? "native-archive-unknown"
            : task.binding
              ? "label-sync-incomplete"
              : task.lastStage === "conflict"
                ? "labels-conflict"
                : task.conversationStatus === "unknown"
                  ? "conversation-unknown"
                  : task.conversationStatus === "none"
                    ? "no-conversation"
                    : (this.archiveDeferrals.get(task.id)?.reason ?? null);
      }
      for (const task of data.tasks) {
        // CUSTOM(done-auto-archive): an archive left uncertain (daemon restart, timeout) whose
        // workspace left the active list did finish natively; only a workspace still listed
        // (archivingAt included) needs the user's confirmation.
        if (
          task.archived?.status === "uncertain" &&
          task.workspaceId &&
          !task.binding &&
          !inventory.workspaces.some((w) => w.id === task.workspaceId)
        ) {
          task.archived = {
            ...task.archived,
            status: "archived",
            detail:
              "No longer in Paseo active workspaces after an uncertain native archive; archive time and cleanup unknown",
          };
          task.issue = null;
          continue;
        }
        if (
          task.workspaceId &&
          !inventory.workspaces.some((w) => w.id === task.workspaceId) &&
          !task.archived &&
          !task.binding &&
          task.issue !== "archive-restored-workspace-unavailable"
        ) {
          task.archived = {
            operationId: randomUUID(),
            kind: "external",
            status: "external",
            stage: task.lastStage,
            group:
              data.settings.groups.find(
                (group) => group.id === task.lastStage,
              ) ?? null,
            startedAt: this.stamp(),
            archivedAt: null,
            lastConversationAt: task.lastConversationAt,
            detail:
              "No longer in Paseo active workspaces; native archive time and cleanup unknown",
          };
        }
      }
    });
    if (connection !== this.connectionGeneration)
      throw new Error(this.error ?? "Paseo disconnected during refresh");
    this.connected = true;
    this.error = null;
    this.refreshedAt = this.stamp();
  }
  /**
   * Combine every agent's evidence into one display time and one archive gate. Only a full
   * exact read of every agent and every provider child can claim an exact time; anything
   * else keeps the newest observed bound so a task never loses its card time, while the gate
   * stays an upper bound that can only delay archiving.
   */
  private async observe(
    agents: readonly Agent[],
    previous: Task | undefined,
    now: number,
    options: { archivedTimeline?: boolean } = {},
  ): Promise<WorkspaceConversation> {
    const readings: Array<{
      agent: Agent;
      conversation: ConversationEvidence;
    }> = [];
    for (const agent of agents) {
      const isChild = Boolean(agent.parentAgentId && agent.subagentId);
      let conversation: ConversationEvidence;
      try {
        conversation = await this.host.conversation(agent, now, options);
      } catch {
        // One unreadable agent degrades its own evidence instead of the whole workspace.
        const bound = isChild ? null : (agent.updatedAt ?? null);
        conversation = {
          displayAt: bound,
          display: bound === null ? "unknown" : "upper-bound",
          gateAt: bound,
          gate: bound === null ? "unknown" : "upper-bound",
          reason: isChild ? "child-timeline-unreadable" : "timeline-unreadable",
        };
      }
      readings.push({ agent, conversation });
    }
    const reasons = new Set<ConversationReason>();
    let lower: number | null = null;
    let upper: number | null = null;
    for (const { agent, conversation } of readings) {
      if (conversation.reason) reasons.add(conversation.reason);
      if (
        agent.childEnumeration === "refused" ||
        agent.childEnumeration === "unavailable"
      )
        reasons.add("child-enumeration-unavailable");
      const time = conversation.displayAt
        ? Date.parse(conversation.displayAt)
        : null;
      if (time !== null) {
        // An upper-bound display value never counts as a lower bound of the conversation.
        if (conversation.display === "upper-bound")
          upper = Math.max(upper ?? time, time);
        else lower = Math.max(lower ?? time, time);
      }
      const isChild = Boolean(agent.parentAgentId && agent.subagentId);
      const activity = isChild ? null : Date.parse(agent.updatedAt);
      if (activity !== null && Number.isFinite(activity))
        upper = Math.max(upper ?? activity, activity);
    }
    const recorded = previous?.conversationAgents ?? [];
    const live = new Set(
      readings
        .filter(({ agent }) => agent.childEnumeration === "complete")
        .map(({ agent }) => agent.id),
    );
    const agentsEvidence: ConversationAgent[] = readings
      .filter(({ agent }) => Boolean(agent.parentAgentId && agent.subagentId))
      .map(({ agent, conversation }) => ({
        id: agent.id,
        lastObservedAt: conversation.displayAt,
        seenWhileLive: live.has(agent.parentAgentId!),
      }));
    const current = new Set(readings.map(({ agent }) => agent.id));
    // CUSTOM(done-auto-archive): a provider child lives inside its parent's turn, so while no agent
    // of this workspace is busy, a parent whose children can't be listed (archived, or the
    // listing failed) bounds them with its own activity time, which `upper` already holds.
    const quiet = readings.every(
      ({ agent }) =>
        agent.activity !== "running" && agent.activity !== "waiting",
    );
    const parentBounds = (childId: string) => {
      const parentId = childId.split("/provider/")[0];
      const parent = readings.find(
        ({ agent }) => agent.id === parentId && !agent.parentAgentId,
      )?.agent;
      return (
        quiet &&
        !!parent &&
        (parent.childEnumeration === "refused" ||
          parent.childEnumeration === "unavailable") &&
        Number.isFinite(Date.parse(parent.updatedAt))
      );
    };
    let blocked = false;
    for (const entry of recorded) {
      if (current.has(entry.id)) continue;
      agentsEvidence.push(entry);
      // A vanished child cannot be re-read, so this workspace can no longer claim an exact
      // time. Its recorded observation still participates in both bounds; without one nothing
      // bounds its conversation any more, unless its quiet parent does.
      reasons.add("child-enumeration-unavailable");
      const time = entry.lastObservedAt
        ? Date.parse(entry.lastObservedAt)
        : null;
      if (time === null || !Number.isFinite(time)) {
        if (!parentBounds(entry.id)) blocked = true;
        continue;
      }
      lower = Math.max(lower ?? time, time);
      upper = Math.max(upper ?? time, time);
    }
    if (lower !== null) upper = Math.max(upper ?? lower, lower);
    // Derived after the vanished children folded in: their reasons and their time decide whether
    // this workspace can claim an exact time or the absence of any conversation at all.
    const exact =
      readings.length > 0 &&
      reasons.size === 0 &&
      readings.every(({ conversation }) => conversation.gate === "exact");
    const noConversation =
      readings.length > 0 &&
      reasons.size === 0 &&
      readings.every(({ conversation }) => conversation.display === "none");
    const reason =
      REASON_ORDER.find((candidate) => reasons.has(candidate)) ?? null;
    const bounded =
      lower === null
        ? upper === null
          ? ({ display: "unknown", gate: "unknown" } as const)
          : ({ display: "upper-bound", gate: "upper-bound" } as const)
        : ({
            display: "lower-bound",
            gate: upper === null ? "unknown" : "upper-bound",
          } as const);
    const boundAt = lower ?? upper;
    const display: ConversationDisplay = exact
      ? "exact"
      : noConversation
        ? "none"
        : bounded.display;
    const gate: ConversationGate = exact
      ? "exact"
      : blocked || noConversation || upper === null
        ? "unknown"
        : "upper-bound";
    const gateAt =
      gate === "exact" ? boundAt : blocked || noConversation ? null : upper;
    return {
      displayAt:
        noConversation || boundAt === null
          ? null
          : new Date(boundAt).toISOString(),
      display,
      gateAt: gateAt === null ? null : new Date(gateAt).toISOString(),
      gate,
      reason: exact || noConversation ? null : reason,
      agents: agentsEvidence,
    };
  }
  /**
   * Re-read one candidate's conversation before archiving it. Returns the gate that the
   * archive decision may use, or null when no bound can be proven right now.
   */
  private async verifyConversation(
    candidate: Task,
    agents: readonly Agent[],
  ): Promise<string | null> {
    let gate: number | null = null;
    try {
      // The archive candidate is the one place that pays for an archived agent's timeline,
      // and a vanished child without a recorded time already forces an unknown gate.
      const evidence = await this.observe(agents, candidate, this.now(), {
        archivedTimeline: true,
      });
      const at = archiveGate({
        conversationGateAt: evidence.gateAt,
        conversationGateEvidence: evidence.gate,
      });
      if (at === null) return null;
      gate = Date.parse(at);
    } catch {
      return null;
    }
    return gate === null || !Number.isFinite(gate)
      ? null
      : new Date(gate).toISOString();
  }
  private async syncPins(
    inventory: Inventory,
    connection: number,
  ): Promise<void> {
    const connected = () =>
      !this.stopped && connection === this.connectionGeneration;
    const wantsPin = (workspace: Workspace) => {
      const settings = this.store.current.settings;
      return (
        settings.pinInProgressWorkspaces &&
        !workspace.archivingAt &&
        groupKind(
          resolveStage(
            workspace.labels,
            settings.groups,
            settings.defaultStartGroup,
          ),
          settings.groups,
        ) === "in-progress"
      );
    };
    for (const listed of inventory.workspaces) {
      if (!connected()) return;
      const id = listed.id;
      const owned = this.store.current.autoPins[id];
      if (owned === undefined && !wantsPin(listed)) continue;
      const observation = this.observation(id);
      const current = () => connected() && observation === this.observation(id);
      const workspace = await this.host.workspace(id);
      if (!workspace || !current()) continue;
      if (!wantsPin(workspace)) {
        if (owned && workspace.pinnedAt === owned)
          await this.host.setPinned(id, false);
        if (owned !== undefined)
          await this.store.update((data) => {
            delete data.autoPins[id];
          });
      } else if (owned === undefined) {
        // Persist before the native write. A lost receipt must not claim a manual pin.
        await this.store.update((data) => {
          data.autoPins[id] = null;
        });
        if (workspace.pinnedAt) continue;
        if (!current()) {
          await this.store.update((data) => {
            delete data.autoPins[id];
          });
          continue;
        }
        const pinnedAt = await this.host.setPinned(id, true);
        await this.store.update((data) => {
          data.autoPins[id] = pinnedAt;
        });
      } else if (owned !== null && workspace.pinnedAt !== owned) {
        await this.store.update((data) => {
          data.autoPins[id] = null;
        });
      }
    }
    if (!connected()) return;
    const active = new Set(
      inventory.workspaces.map((workspace) => workspace.id),
    );
    await this.store.update((data) => {
      for (const id of Object.keys(data.autoPins))
        if (!active.has(id)) delete data.autoPins[id];
    });
  }
  private async saveSettings(
    settings: Settings,
    revision: number,
    expectedSettings?: Settings,
  ): Promise<void> {
    const previous = this.store.current;
    const unchanged = (data: typeof previous) =>
      expectedSettings
        ? isDeepStrictEqual(data.settings, expectedSettings)
        : data.revision === revision;
    if (!unchanged(previous))
      throw new Error("Settings changed; refresh before saving");
    const next = settingsSchema.parse(settings);
    next.pools = previous.settings.pools; // CUSTOM(resource-pools): saved by "pools-save" only
    if (
      next.defaultStartGroup &&
      isTerminalGroup(next.defaultStartGroup, next.groups)
    )
      throw new Error("group-default-terminal");
    if (next.autoArchive) next.archiveMappingNeedsReview = false;
    const previousIds = previous.settings.groups.map((group) => group.id);
    const nextIds = next.groups.map((group) => group.id);
    const retained = nextIds.filter((id) => previousIds.includes(id));
    if (
      !sameOrder(
        retained,
        previousIds.filter((id) => nextIds.includes(id)),
      )
    )
      throw new Error("Groups cannot be reordered here");
    if (nextIds.slice(retained.length).some((id) => previousIds.includes(id)))
      throw new Error("Groups cannot be reordered here");
    if (!sameOrder(next.groupOrder, previous.settings.groupOrder))
      throw new Error("Group order changed; refresh before saving");
    next.groupOrder = previous.settings.groupOrder.length
      ? orderedGroups({
          groups: next.groups,
          groupOrder: previous.settings.groupOrder,
        }).map((group) => group.id)
      : [];
    const removed = previous.settings.groups.filter(
      (group) => !next.groups.some((candidate) => candidate.id === group.id),
    );
    for (const task of previous.tasks.filter((task) => !hidden(task))) {
      if (task.binding) {
        const oldGroup = previous.settings.groups.find(
          (group) => group.id === task.binding!.stage,
        )!;
        const newGroup = next.groups.find(
          (group) => group.id === task.binding!.stage,
        );
        if (
          !newGroup ||
          newGroup.kind !== oldGroup.kind ||
          newGroup.label !== oldGroup.label
        )
          throw new Error(
            "A workspace binding still uses this group; finish binding first",
          );
      }
      if (!task.workspaceId && !isDraftGroup(task.draftStage, next.groups))
        throw new Error(
          removed.some((group) => group.id === task.draftStage)
            ? "group-tasks-in-use"
            : "Move the drafts out before deleting this group or changing its type",
        );
    }
    if (removed.length) {
      const epoch = this.epoch;
      const inventory = await this.inventoryNow();
      if (epoch !== this.epoch || !this.connected)
        throw new Error("Workspaces changed; refresh before deleting a group");
      for (const group of removed) {
        const missingTasks = previous.tasks.some(
          (task) =>
            !hidden(task) &&
            task.workspaceId &&
            task.lastStage === group.id &&
            !inventory.workspaces.some(
              (workspace) => workspace.id === task.workspaceId,
            ),
        );
        if (
          missingTasks ||
          inventory.workspaces.some((workspace) =>
            workspace.labels.some(
              (label) => labelKey(label) === labelKey(group.label),
            ),
          )
        )
          throw new Error("group-tasks-in-use");
        if (
          group.id ===
            defaultGroup(previous.settings.groups, next.defaultDraftGroup) ||
          group.id ===
            defaultWorkspaceGroup(
              previous.settings.groups,
              next.defaultStartGroup,
            ) ||
          group.id === next.defaultStartWorkGroup
        )
          throw new Error("group-default-in-use");
      }
    }
    if (
      next.defaultStartWorkGroup &&
      groupKind(next.defaultStartWorkGroup, next.groups) !== "in-progress"
    ) {
      if (
        next.defaultStartWorkGroup ===
          previous.settings.defaultStartWorkGroup &&
        groupKind(next.defaultStartWorkGroup, previous.settings.groups) ===
          "in-progress"
      )
        throw new Error("group-default-in-use");
      throw new Error("group-default-start-work-invalid");
    }
    await this.store.update((data) => {
      if (!unchanged(data))
        throw new Error("Settings changed; refresh before saving");
      for (const group of removed) delete data.cardOrderByStage[group.id];
      data.settings = next;
    }, CONFIG_EDIT);
  }
  private checkCardOrder(
    data: Data,
    input: Extract<Mutation, { action: "reorder-cards" | "reset-card-order" }>,
  ): void {
    if (!data.settings.groups.some((group) => group.id === input.stage))
      throw new Error("Group no longer exists");
    const current = cardsForStage(
      this.snapshot(data).cards,
      input.stage,
      data.cardOrderByStage,
    ).map((card) => card.id);
    if (!sameOrder(input.expectedOrder, current))
      throw new Error("card-order-changed");
    if (input.action === "reorder-cards") {
      const mover = data.tasks.find((task) => task.id === input.taskId);
      if (
        !mover ||
        !current.includes(input.taskId) ||
        mover.archived !== null ||
        mover.binding !== null
      )
        throw new Error("card-order-mover-unavailable");
      if (
        input.cardOrder.length !== current.length ||
        new Set(input.cardOrder).size !== current.length ||
        input.cardOrder.some((id) => !current.includes(id)) ||
        !sameOrder(
          input.cardOrder.filter((id) => id !== input.taskId),
          current.filter((id) => id !== input.taskId),
        )
      )
        throw new Error("card-order-invalid");
    }
  }
  private checkStageExpected(
    data: Data,
    input: Extract<Mutation, { action: "stage" }>,
  ): void {
    if (input.expectedGroup) {
      const group = data.settings.groups.find(
        (group) => group.id === input.stage,
      );
      const expected = input.expectedGroup;
      if (
        !group ||
        expected.id !== group.id ||
        expected.kind !== group.kind ||
        expected.label !== group.label
      )
        throw new Error("stage-group-changed");
    }
    if (
      input.expectedUpdatedAt !== undefined &&
      data.tasks.find((task) => task.id === input.taskId)?.updatedAt !==
        input.expectedUpdatedAt
    )
      throw new Error("stage-task-changed");
  }
  /** CUSTOM(assistant-cards): `by` is who asked, for the history (the chat's tools pass `assistant`). */
  async mutate(
    input: Mutation,
    by: Exclude<HistoryActor, "orchestrator"> = "user",
  ): Promise<Board> {
    // Reject before queueing so an active or queued start cannot be canceled after it fails.
    if (
      input.action === "cancel-binding" &&
      (this.bindingInFlight.has(input.operationId) ||
        this.queuedStarts.has(input.taskId))
    )
      throw new Error(CANCEL_BINDING_BUSY_ERROR_CODE);
    if (input.action === "start")
      this.queuedStarts.set(
        input.taskId,
        (this.queuedStarts.get(input.taskId) ?? 0) + 1,
      );
    this.epoch++;
    this.pendingMutations++;
    return this.serial(async () => {
      if (!this.connected)
        throw new Error(this.error ?? "Paseo is disconnected");
      try {
        if (input.action === "create") {
          // CUSTOM(night-tasks): a timing puts the task in Scheduled.
          let timing = checkTiming(input.timing ?? null);
          const stage = timing
            ? this.scheduledGroup()
            : (input.stage ??
              defaultGroup(
                this.store.current.settings.groups,
                this.store.current.settings.defaultDraftGroup,
              ));
          // A new task can also go straight to Ready to start, where an orchestrator takes it.
          const kind = groupKind(stage, this.store.current.settings.groups);
          if (kind !== "todo" && kind !== "ready" && kind !== "scheduled")
            throw new Error("Choose a To do group for a new draft");
          if (kind === "scheduled") timing ??= { kind: "night" };
          const taskId = randomUUID();
          await this.store.update((data, descriptions) => {
            const task = newTask(
              taskId,
              input.title,
              this.stamp(),
              stage,
              data.nextTaskNumber, // CUSTOM(task-numbers)
            );
            data.nextTaskNumber += 1;
            descriptions.set(taskId, input.description);
            task.projectId = input.projectId;
            task.orchestratorId = input.orchestratorId ?? null;
            task.timing = timing; // CUSTOM(night-tasks)
            task.projectName =
              this.inventory.projects.find((p) => p.id === input.projectId)
                ?.name ?? "";
            data.tasks.push(task);
          });
          // CUSTOM(assistant-reports): an automatic item of the Reports page.
          if (this.assistantOn())
            await this.record(
              taskId,
              "task-created",
              `Created "${input.title}" in ${this.groupLabel(stage)}`,
              { agentId: null, attempt: null, action: null, by },
            );
          if (kind === "ready") await this.orchestrate();
          else if (timing) this.armDueTimer(); // CUSTOM(night-tasks)
        } else if (input.action === "night-settings") {
          // CUSTOM(night-tasks)
          await this.store.update((data) => {
            data.night = nightSettingsSchema.parse(input.night);
          }, CONFIG_EDIT);
          await this.orchestrate();
        } else if (input.action === "night-shutdown-cancel") {
          await this.store.update((data) => {
            const runtime = data.nightRuntime;
            if (!runtime.shutdownAt) return;
            runtime.handledFor = runtime.windowStart;
            runtime.shutdownAt = null;
            this.nightLog(data, "Power-off canceled");
          });
          this.armDueTimer();
        } else if (input.action === "refine") {
          await this.refine(input.taskId);
        } else if (input.action === "review") {
          await this.review(input.taskId, input.outcome, input.feedback, by);
        } else if (input.action === "orchestrator-defaults") {
          await this.store.update((data) => {
            data.orchestrator = orchestratorSchema.parse({
              ...data.orchestrator,
              ...input.orchestrator,
            });
          }, CONFIG_EDIT);
        } else if (input.action === "orchestrator-save") {
          const id = input.orchestrator.id ?? randomUUID();
          const next = orchestratorConfigSchema.parse({
            ...input.orchestrator,
            id,
          });
          // CUSTOM(resource-pools)
          if (
            next.poolId !== null &&
            !this.store.current.settings.pools.some((p) => p.id === next.poolId)
          )
            throw new Error("Pool no longer exists");
          const created = !this.store.current.orchestrators.some(
            (o) => o.id === id,
          );
          await this.store.update((data) => {
            data.orchestrators = created
              ? [...data.orchestrators, next]
              : data.orchestrators.map((o) => (o.id === id ? next : o));
          }, CONFIG_EDIT);
          await this.log(id, "info", created ? "Created" : "Settings saved");
          await this.orchestrate();
        } else if (input.action === "orchestrators-set-agent") {
          // CUSTOM(bulk-orchestrator-agent)
          const provider = providerModelSchema.safeParse(input.provider);
          if (!provider.success) throw new Error("provider-model-invalid");
          const ids = new Set(input.ids);
          const selected = this.store.current.orchestrators.filter((o) =>
            ids.has(o.id),
          );
          if (selected.length === 0)
            throw new Error("No orchestrators selected");
          await this.store.update((data) => {
            data.orchestrators = data.orchestrators.map((config) =>
              ids.has(config.id)
                ? // Same parse as "orchestrator-save": the mode is stored as the form
                  // saves it, and the agent start resolves the provider's full-access
                  // mode from `unattended` (`autoPermissionFor`).
                  orchestratorConfigSchema.parse({
                    ...config,
                    provider: provider.data,
                    modeId: input.modeId,
                    thinkingOptionId: input.thinkingOptionId,
                    // CUSTOM(unattended-automation)
                    ...(input.autoAccept === undefined
                      ? {}
                      : { autoAccept: input.autoAccept }),
                  })
                : config,
            );
          }, CONFIG_EDIT);
          for (const config of selected)
            await this.log(
              config.id,
              "info",
              `Agent changed to ${input.provider}`,
            );
          await this.orchestrate();
        } else if (input.action === "finish") {
          await this.startFinish(input.taskId, input.step);
        } else if (input.action === "orchestrator-delete") {
          this.orchestratorConfig(input.id);
          await this.store.update((data) => {
            data.orchestrators = data.orchestrators.filter(
              (o) => o.id !== input.id,
            );
            delete data.orchestratorRuntime[input.id];
            delete data.orchestratorLogs[input.id];
            for (const task of data.tasks)
              if (task.orchestratorId === input.id) task.orchestratorId = null;
          }, CONFIG_EDIT);
        } else if (input.action === "orchestrator-move") {
          // CUSTOM(resource-pools): swaps it with its neighbour in the list.
          this.orchestratorConfig(input.id);
          const list = this.store.current.orchestrators;
          const from = list.findIndex((o) => o.id === input.id);
          const to = input.direction === "up" ? from - 1 : from + 1;
          if (to >= 0 && to < list.length) {
            await this.store.update((data) => {
              const next = [...data.orchestrators];
              [next[from], next[to]] = [next[to]!, next[from]!];
              data.orchestrators = next;
            }, CONFIG_EDIT);
            await this.orchestrate();
          }
        } else if (input.action === "pools-save") {
          // CUSTOM(resource-pools)
          await this.store.update((data) => {
            data.settings.pools = input.pools;
            for (const config of data.orchestrators)
              if (
                config.poolId !== null &&
                !input.pools.some((pool) => pool.id === config.poolId)
              )
                config.poolId = null;
          }, CONFIG_EDIT);
          await this.orchestrate();
        } else if (input.action === "orchestrator-run") {
          const config = this.orchestratorConfig(input.id);
          if (!config.enabled) throw new Error("Orchestrator is disabled");
          await this.setRuntime(input.id, {
            quota: config.batchSize,
            started: 0,
            runStartedAt: this.stamp(),
          });
          await this.log(
            input.id,
            "info",
            `Run now: up to ${config.batchSize} tasks, ${config.maxConcurrent} at a time`,
          );
          await this.orchestrate();
        } else if (input.action === "orchestrator-enable") {
          this.orchestratorConfig(input.id);
          await this.store.update((data) => {
            data.orchestrators = data.orchestrators.map((o) =>
              o.id === input.id ? { ...o, enabled: input.enabled } : o,
            );
          }, CONFIG_EDIT);
          await this.log(
            input.id,
            "info",
            input.enabled
              ? "Enabled"
              : "Disabled: no new tasks start; running agents keep going",
          );
          if (!input.enabled && this.runtime(input.id).quota > 0)
            await this.endRun(input.id, "disabled");
          await this.orchestrate();
        } else if (input.action === "orchestrator-stop") {
          this.orchestratorConfig(input.id);
          await this.setRuntime(input.id, { quota: 0, runStartedAt: null });
          await this.log(
            input.id,
            "info",
            "Stopped: no new tasks start; running agents keep going",
          );
        } else if (input.action === "package-create") {
          await this.packageCreate(
            input.name,
            input.projectId,
            input.taskIds,
            by === "assistant" ? "assistant" : "user",
          );
        } else if (input.action === "package-assign") {
          await this.packageAssign(input.packageId, input.taskIds);
        } else if (input.action === "package-remove") {
          await this.packageRemove(input.taskIds);
        } else if (input.action === "package-delete") {
          await this.packageDelete(input.packageId);
        } else if (input.action === "package-update") {
          await this.packageUpdate(input.packageId, input);
        } else if (input.action === "package-close") {
          await this.packageClose(input.packageId, input.runGate);
        } else if (input.action === "package-run-gate") {
          await this.startPackageGate(input.packageId, "manual");
        } else if (input.action === "set-test-tier") {
          await this.setTestTier(
            input.taskId,
            input.tier,
            input.reason,
            by === "assistant" ? "pm" : "user",
          );
        } else if (input.action === "settings") {
          await this.saveSettings(
            input.settings,
            input.revision,
            input.expectedSettings,
          );
          await this.reconcile();
          this.changed();
        } else if (
          input.action === "reorder-cards" ||
          input.action === "reset-card-order"
        ) {
          this.checkCardOrder(this.store.current, input);
          await this.store.update((data) => {
            this.checkCardOrder(data, input);
            if (input.action === "reset-card-order")
              delete data.cardOrderByStage[input.stage];
            else data.cardOrderByStage[input.stage] = input.cardOrder;
          });
        } else if (input.action === "reorder-groups") {
          const current = orderedGroups(this.store.current.settings).map(
            (group) => group.id,
          );
          const groups = this.store.current.settings.groups;
          if (!sameOrder(input.expectedGroupOrder, current))
            throw new Error("Group order changed; refresh before reordering");
          if (
            input.groupOrder.length !== groups.length ||
            input.groupOrder.some(
              (id) => !groups.some((group) => group.id === id),
            )
          )
            throw new Error("Group order is invalid");
          await this.store.update((data) => {
            const fresh = orderedGroups(data.settings).map((group) => group.id);
            if (!sameOrder(input.expectedGroupOrder, fresh))
              throw new Error("Group order changed; refresh before reordering");
            data.settings.groupOrder = input.groupOrder;
          }, CONFIG_EDIT);
        } else {
          const task = this.task(input.taskId);
          if (
            hidden(task) &&
            input.action !== "resolve-archive" &&
            input.action !== "delete-task"
          )
            throw new Error(
              input.action === "detach-draft"
                ? "detach-draft-archived"
                : "Task is archived",
            );
          if (input.action === "edit") {
            await this.store.update((data, descriptions) => {
              const current = data.tasks.find((t) => t.id === task.id)!;
              if (current.updatedAt !== input.updatedAt)
                throw new Error("Task changed; refresh before saving");
              if (!current.workspaceId) {
                current.title = input.title;
                current.projectId = input.projectId;
                current.projectName =
                  this.inventory.projects.find((p) => p.id === input.projectId)
                    ?.name ?? "";
              }
              descriptions.set(current.id, input.description);
              if (input.orchestratorId !== undefined)
                current.orchestratorId = input.orchestratorId;
              // CUSTOM(night-tasks): only a draft can be scheduled; it moves in or out of Scheduled.
              if (
                input.timing !== undefined &&
                !current.workspaceId &&
                !current.binding
              ) {
                const timing = checkTiming(input.timing);
                const scheduled =
                  groupKind(current.draftStage, data.settings.groups) ===
                  "scheduled";
                const stage =
                  timing && !scheduled
                    ? this.scheduledGroup(data)
                    : !timing && scheduled
                      ? defaultGroup(
                          data.settings.groups,
                          data.settings.defaultDraftGroup,
                        )
                      : current.draftStage;
                current.timing = timing;
                current.draftStage = stage;
                current.lastStage = stage;
              }
              current.updatedAt = this.stamp(current.updatedAt);
            });
            await this.orchestrate();
          } else if (input.action === "start") {
            if (!task.binding && task.workspaceId)
              throw new Error("Task already has a workspace");
            const stage =
              input.stage ??
              task.binding?.stage ??
              defaultStartWorkGroup(
                this.store.current.settings.groups,
                this.store.current.settings.defaultStartWorkGroup,
              );
            if (
              !stage ||
              !this.store.current.settings.groups.some(
                (group) => group.id === stage,
              )
            )
              throw new Error("Add an In progress group before starting work");
            if (isDraftGroup(stage, this.store.current.settings.groups))
              throw new Error(
                "Choose a working or completed group for the workspace",
              );
            if (
              task.binding &&
              (JSON.stringify(task.binding.target) !==
                JSON.stringify(input.target) ||
                task.binding.stage !== stage)
            )
              throw new Error(
                "A previous binding is pending; retry its original target",
              );
            if (!task.binding)
              await this.store.update((data) => {
                const current = data.tasks.find((t) => t.id === task.id)!;
                current.binding = {
                  operationId: randomUUID(),
                  target: input.target,
                  workspaceId: null,
                  stage,
                };
                current.timing = null; // CUSTOM(night-tasks): started by hand
              });
            await this.bind(task.id);
            await this.reconcile();
          } else if (input.action === "stage") {
            const check = () => {
              if (
                input.expectedUpdatedAt !== undefined ||
                input.expectedGroup !== undefined
              )
                this.checkStageExpected(this.store.current, input);
            };
            check();
            if (
              !this.store.current.settings.groups.some(
                (group) => group.id === input.stage,
              )
            )
              throw new Error("Group no longer exists");
            if (task.binding)
              throw new Error("Workspace binding is still pending");
            // CUSTOM(night-tasks): Scheduled holds drafts only.
            const toScheduled =
              groupKind(input.stage, this.store.current.settings.groups) ===
              "scheduled";
            if (task.workspaceId && toScheduled)
              throw new Error(
                "Only a task without a workspace can be scheduled",
              );
            if (task.workspaceId) {
              const workspace = await this.transition(
                task.workspaceId,
                input.stage,
                input.expectedLabels,
                check,
              );
              this.inventory.workspaces = this.inventory.workspaces.map((w) =>
                w.id === workspace.id ? workspace : w,
              );
              await this.store.update((data) => {
                const current = data.tasks.find((t) => t.id === task.id)!;
                this.checkStageExpected(data, input);
                current.lastStage = input.stage;
                current.updatedAt = this.stamp(current.updatedAt);
                if (current.issue === "labels-conflict") current.issue = null;
              });
              this.changed(workspace.id);
            } else {
              if (
                !isDraftGroup(input.stage, this.store.current.settings.groups)
              )
                throw new Error("Start work and bind a workspace first");
              await this.store.update((data) => {
                const current = data.tasks.find((t) => t.id === task.id)!;
                this.checkStageExpected(data, input);
                current.draftStage = input.stage;
                current.lastStage = input.stage;
                // CUSTOM(night-tasks): dropped in Scheduled it waits for the night; out of it, no timing.
                current.timing = toScheduled
                  ? (current.timing ?? { kind: "night" })
                  : null;
                current.updatedAt = this.stamp(current.updatedAt);
              });
              // A draft moved to Ready to start may be taken right away.
              await this.orchestrate();
            }
            // CUSTOM(assistant-reports): an automatic item of the Reports page.
            if (this.assistantOn())
              await this.record(
                task.id,
                "task-moved",
                `Moved to ${this.groupLabel(input.stage)}`,
                { agentId: null, action: null, by },
              );
          } else if (input.action === "delete-task") {
            await this.deleteTask(task, by);
          } else if (input.action === "archive-draft") {
            if (
              task.workspaceId ||
              groupKind(task.draftStage, this.store.current.settings.groups) !==
                "canceled" ||
              task.binding
            )
              throw new Error(
                "Only canceled, unbound drafts can be archived here",
              );
            await this.store.update((data) => {
              data.tasks.find((t) => t.id === task.id)!.archived = {
                operationId: randomUUID(),
                kind: "draft",
                status: "archived",
                stage: task.draftStage,
                group:
                  data.settings.groups.find(
                    (group) => group.id === task.draftStage,
                  ) ?? null,
                startedAt: this.stamp(),
                archivedAt: this.stamp(),
                lastConversationAt: null,
                detail: "Draft archived; no native workspace",
              };
            });
          } else if (input.action === "detach-draft") {
            await this.store.update((data, descriptions) => {
              const current = data.tasks.find((t) => t.id === task.id)!;
              if (current.updatedAt !== input.updatedAt)
                throw new Error("detach-draft-stale");
              const source = current.mergedDrafts.find(
                (source) => source.draftId === input.draftId,
              );
              if (!source) throw new Error("detach-draft-missing");
              if (data.tasks.some((t) => t.id === source.draftId))
                throw new Error("detach-draft-id-in-use");
              const text = descriptions.get(current.id);
              const start = text.indexOf(source.appendedText);
              if (
                start < 0 ||
                text.indexOf(source.appendedText, start + 1) >= 0
              )
                throw new Error("detach-draft-text-changed");
              const draft = newTask(
                source.draftId,
                source.title,
                this.stamp(),
                defaultGroup(
                  data.settings.groups,
                  data.settings.defaultDraftGroup,
                ),
                data.nextTaskNumber, // CUSTOM(task-numbers)
              );
              data.nextTaskNumber += 1;
              descriptions.set(draft.id, source.description);
              descriptions.set(
                current.id,
                text.slice(0, start) +
                  text.slice(start + source.appendedText.length),
              );
              current.mergedDrafts = current.mergedDrafts.filter(
                (entry) => entry !== source,
              );
              current.updatedAt = this.stamp(current.updatedAt);
              data.tasks.push(draft);
            });
          } else if (input.action === "cancel-binding") {
            if (!task.binding) throw new Error("cancel-binding-missing");
            if (task.binding.operationId !== input.operationId)
              throw new Error("cancel-binding-changed");
            await this.store.update((data) => {
              const current = data.tasks.find((t) => t.id === task.id)!;
              current.binding = null;
              current.issue = null;
              current.updatedAt = this.stamp(current.updatedAt);
            });
          } else if (input.action === "resolve-archive") {
            await this.store.update((data) => {
              const current = data.tasks.find((t) => t.id === task.id)!;
              if (current.updatedAt !== input.updatedAt)
                throw new Error("archive-resolution-stale");
              const archive = current.archived;
              if (
                !archive ||
                (!["uncertain", "external"].includes(archive.status) &&
                  !(
                    archive.status === "archived" && input.outcome === "restore"
                  ))
              )
                throw new Error("archive-resolution-unavailable");
              if (archive.operationId !== input.operationId)
                throw new Error("archive-resolution-stale");
              if (input.outcome === "confirm") {
                current.archived = {
                  ...archive,
                  status: "archived",
                  detail: "archive-confirmed-by-user",
                };
                current.issue = null;
              } else {
                if (
                  !data.settings.groups.some(
                    (group) => group.id === archive.stage,
                  )
                )
                  throw new Error("archive-group-unavailable");
                if (
                  archive.kind === "draft" &&
                  !isDraftGroup(archive.stage, data.settings.groups)
                )
                  throw new Error("archive-draft-group-unavailable");
                current.archived = null;
                if (archive.kind === "draft")
                  current.draftStage = archive.stage;
                current.lastStage = archive.stage;
                // Keep the manual restore until reconciliation confirms native membership.
                current.issue = current.workspaceId
                  ? "archive-restored-workspace-unavailable"
                  : null;
              }
              current.updatedAt = this.stamp(current.updatedAt);
            });
            this.archiveDeferrals.delete(task.id);
          }
        }
        return this.snapshot();
      } catch (error) {
        try {
          await this.load();
        } catch (storageError) {
          this.disconnected(message(storageError));
        }
        throw error;
      }
    }).finally(() => {
      this.pendingMutations--;
      if (input.action === "start") {
        const remaining = this.queuedStarts.get(input.taskId)! - 1;
        if (remaining) this.queuedStarts.set(input.taskId, remaining);
        else this.queuedStarts.delete(input.taskId);
      }
    });
  }
  /**
   * CUSTOM(delete-task): stop the task's agents, forget every record and timer keyed by it, and
   * drop it from the board. Runs inside `serial`, so no start, binding or orchestrator pass is
   * halfway through it. The workspace, branch and commits are left as they are.
   */
  private async deleteTask(task: Task, by: HistoryActor): Promise<void> {
    const data = this.store.current;
    const agentIds = new Set(
      [
        data.orchestrations[task.id]?.agentId,
        data.refinements[task.id]?.agentId,
      ].filter((id): id is string => !!id),
    );
    for (const agentId of agentIds)
      await this.host.archiveAgent(agentId).catch(() => undefined);
    // Recorded while the task still exists: the history reads its title and project from it.
    await this.record(
      task.id,
      "task-deleted",
      `Deleted ${taskNumberLabel(task.number) || task.id}: ${task.title}`,
      { agentId: null, action: null, by },
    );
    this.retryAt.delete(task.id);
    this.clearDirtyTimer(task.id);
    this.clearFolderTimer(task.id);
    this.loggedFolderCommitWaits.delete(task.id);
    this.lateIdleSince.delete(task.id);
    this.lateChecked.delete(task.id);
    this.archiveDeferrals.delete(task.id);
    this.wakePending.delete(task.id);
    // The store deletes the description file of a task that left the board. Attempts stay: they
    // are the task's record, and the next load prunes old ones of tasks off the board.
    await this.store.update((data) => {
      data.tasks = data.tasks.filter((t) => t.id !== task.id);
      delete data.orchestrations[task.id];
      delete data.refinements[task.id];
      delete data.finishes[task.id];
      delete data.assistant.deliveries[task.id];
      delete data.assistant.progress[task.id];
      for (const [stage, order] of Object.entries(data.cardOrderByStage))
        if (order.includes(task.id))
          data.cardOrderByStage[stage] = order.filter((id) => id !== task.id);
    });
  }
  private async bind(id: string): Promise<void> {
    const draft = this.task(id);
    const binding = draft.binding;
    if (!binding) return;
    this.bindingInFlight.add(binding.operationId);
    try {
      const workspaceId =
        binding.workspaceId ??
        (binding.target.kind === "existing"
          ? binding.target.workspaceId
          : await this.host.create(
              binding.target.source,
              draft.title,
              `workboard:${binding.operationId}`,
              await this.worktreeBase(binding.target.source), // CUSTOM(worktree-base)
            ));
      const workspace = await this.host.workspace(workspaceId);
      if (!workspace) throw new Error("Binding workspace is unavailable");
      let survivorId = id;
      await this.store.update((data, descriptions) => {
        const current = data.tasks.find((t) => t.id === id)!;
        const imported = data.tasks.find(
          (t) => t.workspaceId === workspaceId && t.id !== id,
        );
        const currentText = descriptions.get(current.id);
        if (binding.target.kind === "existing" && imported) {
          const importedText = descriptions.get(imported.id);
          const appendedText = `${importedText ? "\n\n" : ""}[${current.title}]\n${currentText}`;
          descriptions.set(imported.id, importedText + appendedText);
          imported.mergedDrafts.push({
            draftId: current.id,
            title: current.title,
            description: currentText,
            mergedAt: this.stamp(),
            appendedText,
          });
          imported.binding = { ...binding, workspaceId };
          imported.updatedAt = this.stamp(imported.updatedAt);
          survivorId = imported.id;
          data.tasks = data.tasks.filter((t) => t.id !== id);
        } else {
          let text = currentText;
          if (imported) {
            text = [text, descriptions.get(imported.id)]
              .filter(Boolean)
              .join("\n\n");
            data.tasks = data.tasks.filter((t) => t.id !== imported.id);
          }
          if (binding.target.kind === "existing" && !binding.workspaceId)
            text = `[${current.title}]\n${text}`;
          descriptions.set(current.id, text);
          current.workspaceId = workspaceId;
          current.binding = { ...binding, workspaceId };
          current.updatedAt = this.stamp(current.updatedAt);
        }
      });
      try {
        await this.transition(
          workspaceId,
          binding.stage,
          statusLabels(workspace.labels, this.store.current.settings.groups),
        );
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === survivorId)!;
          task.binding = null;
          task.issue = null;
        });
      } catch (error) {
        await this.issue(survivorId, "label-sync-incomplete");
        throw error;
      }
    } finally {
      this.bindingInFlight.delete(binding.operationId);
    }
  }
  /**
   * CUSTOM(worktree-base): the branch a task's new worktree starts from: the project policy's
   * `baseBranch`, else the project checkout's current branch. Undefined leaves it to the daemon,
   * which uses the repository's default branch. The merge targets the same branch, so its
   * base-ref check passes.
   */
  private async worktreeBase(
    source: Extract<StartInput["target"], { kind: "new" }>["source"],
  ): Promise<string | undefined> {
    if (source.kind !== "worktree") return undefined;
    const configured = this.policy(source.projectId).baseBranch.trim();
    if (configured) return configured;
    const project = this.inventory.projects.find(
      (p) => p.id === source.projectId,
    );
    if (!project) return undefined;
    return (await this.host.currentBranch(project.directory)) ?? undefined;
  }
  private async transition(
    id: string,
    stage: Stage,
    expected: string[],
    check: () => void = () => {},
  ): Promise<Workspace> {
    const mapping = this.store.current.settings.groups;
    const group = mapping.find((group) => group.id === stage);
    if (!group) throw new Error("Group no longer exists");
    let workspace = await this.host.workspace(id);
    check();
    if (!workspace || workspace.archivingAt)
      throw new Error("Workspace is unavailable or archiving");
    if (!labelsEqual(statusLabels(workspace.labels, mapping), expected))
      throw new Error(
        "Workspace labels changed; refresh before changing stage",
      );
    const target = group.label;
    let observed = workspace.labels;
    const operations: Array<{ name: string; assigned: boolean }> = [];
    if (!observed.some((name) => labelKey(name) === labelKey(target)))
      operations.push({ name: target, assigned: true });
    for (const name of statusLabels(observed, mapping))
      if (labelKey(name) !== labelKey(target))
        operations.push({ name, assigned: false });
    for (const operation of operations) {
      workspace = await this.host.workspace(id);
      check();
      if (
        !workspace ||
        !labelsEqual(
          statusLabels(workspace.labels, mapping),
          statusLabels(observed, mapping),
        )
      )
        throw new Error("Workspace labels changed during synchronization");
      const intended = operation.assigned
        ? [...observed, operation.name]
        : observed.filter(
            (name) => labelKey(name) !== labelKey(operation.name),
          );
      observed = await this.host.setLabel(
        id,
        operation.name,
        STAGE_COLORS[group.kind],
        operation.assigned,
      );
      check();
      if (
        !labelsEqual(
          statusLabels(observed, mapping),
          statusLabels(intended, mapping),
        )
      )
        throw new Error("Workspace labels changed during synchronization");
    }
    workspace = await this.host.workspace(id);
    check();
    if (
      !workspace ||
      resolveStage(
        workspace.labels,
        mapping,
        this.store.current.settings.defaultStartGroup,
      ) !== stage
    )
      throw new Error("Label synchronization could not be verified");
    return workspace;
  }
  /** Open (or reopen) the refinement chat of a draft. Runs inside `serial`. */
  private async refine(taskId: string): Promise<void> {
    const task = this.task(taskId);
    if (task.workspaceId || task.binding)
      throw new Error("Only a draft can be refined");
    const existing = this.store.current.refinements[taskId];
    if (existing && (await this.host.agentAlive(existing.agentId))) return;
    const project = this.inventory.projects.find(
      (p) => p.id === task.projectId,
    );
    if (!project) throw new Error("Choose a project for this task");
    const defaults = this.store.current.orchestrator;
    // CUSTOM(factory): Refine runs the project's spec stage. The chat uses the settings of the
    // worker that runs that stage; else the task's orchestrator, else the defaults. It is always
    // in the refinement mode.
    const stage = await this.refineStage(task);
    const settings =
      this.store.current.orchestrators.find(
        (o) => o.id === (stage.orchestratorId ?? task.orchestratorId),
      ) ?? defaults;
    const agentId = await this.host.startAgentIn(project.directory, {
      provider: settings.provider,
      modeId: defaults.refineModeId,
      thinkingOptionId: settings.thinkingOptionId,
      title: refinementChatTitle(task.title),
      prompt: specChatPrompt(
        this.ticket(task),
        settings.instructions,
        stage.text,
      ),
      labels: { [REFINEMENT_CHAT_LABEL]: "true" }, // CUSTOM(sidebar-agent-tabs)
      // CUSTOM(unattended-automation)
      unattended: true, // refinement chats have no form: full access
    });
    await this.setRefinement(taskId, {
      agentId,
      status: "chatting",
      error: null,
    });
  }
  /**
   * CUSTOM(factory): the spec stage Refine runs, as the text its chat gets and the worker that
   * runs it. Active mode, with the Project Manager on or off: the project pipeline's spec stage
   * (`refineSpecStage`), with its worker; a pipeline with no spec stage gets the factory's
   * `roles/spec.md` and the project's spec template. Off mode: the built-in ones. No worker means
   * the task's orchestrator, else the defaults.
   */
  private async refineStage(
    task: Task,
  ): Promise<{ text: string; orchestratorId: string | null }> {
    // The chat needs no Project Manager, so it reads the pipeline the factory gives the project
    // even when the PM is off and the pipeline does not run the task.
    const entry = this.factoryPipeline(task.projectId);
    const stage = entry && refineSpecStage(entry.pipeline);
    if (entry && stage) {
      const runner = this.stageOrchestrator(
        entry.applied,
        stage,
        task.projectId,
        this.store.current,
      );
      const chosen =
        !!task.orchestratorId &&
        this.store.current.orchestrators.some(
          (o) => o.id === task.orchestratorId,
        );
      return {
        text: await this.stagePrompt(
          entry.applied,
          entry.pipeline,
          stage,
          task.projectId,
        ),
        orchestratorId:
          !runner || (runner.fallback && chosen && !stage.worker)
            ? null
            : runner.id,
      };
    }
    let prompt = BUILTIN_SPEC_PROMPT;
    let template = BUILTIN_SPEC_TEMPLATE;
    if (entry) {
      const project = entry.applied.compiled.projects.find(
        (p) => p.projectId === task.projectId,
      );
      prompt =
        (
          await readFile(
            join(entry.applied.root, "roles/spec.md"),
            "utf8",
          ).catch(() => "")
        ).trim() || prompt;
      template =
        (await readFile(
          join(
            entry.applied.root,
            project?.specTemplate ?? "templates/spec.md",
          ),
          "utf8",
        ).catch(() => null)) || template;
    }
    return {
      text: [
        "## Pipeline stage: spec (spec)",
        prompt.trim(),
        `### Spec template\n\n${template.trim()}`,
      ].join("\n\n"),
      orchestratorId: null,
    };
  }
  private setRefinement(
    taskId: string,
    change: Partial<Refinement> & { agentId?: string },
  ): Promise<void> {
    return this.store.update((data) => {
      const previous = data.refinements[taskId];
      if (!previous && !change.agentId) return;
      data.refinements[taskId] = {
        ...(previous ?? {
          agentId: change.agentId!,
          status: "chatting",
          error: null,
        }),
        ...change,
        updatedAt: this.stamp(),
      } as Refinement;
    });
  }
  /**
   * A Done task's Commit, PR description or Merge button. Marks the step as running and
   * returns; the git work runs outside `serial` and records its outcome when it ends.
   */
  private async startFinish(taskId: string, step: FinishStep): Promise<void> {
    const task = this.task(taskId);
    const groups = this.store.current.settings.groups;
    if (!task.workspaceId || groupKind(task.lastStage, groups) !== "done")
      throw new Error("Only a Done task with a workspace can be finished");
    const workspace = this.inventory.workspaces.find(
      (w) => w.id === task.workspaceId,
    );
    if (!workspace) throw new Error("Workspace is unavailable or archiving");
    if (workspace.projectKind !== "git")
      throw new Error("This task's project is not a git repository");
    if (this.store.current.finishes[taskId]?.running)
      throw new Error("A git action is already running for this task");
    const agentId =
      this.store.current.orchestrations[taskId]?.agentId ??
      this.inventory.agents.find(
        (a) => a.workspaceId === task.workspaceId && !a.archivedAt,
      )?.id ??
      null;
    if (step === "pr" && !agentId)
      throw new Error("No agent of this task can write the description");
    // CUSTOM(orchestrator-in-place): the folder's branch is the delivery branch; there is no
    // separate branch to merge into it.
    if (
      step === "merge" &&
      this.store.current.orchestrations[taskId]?.inPlace === true
    )
      throw new Error(
        "This task runs in the project folder; its work is already on the branch",
      );
    const directory = workspace.workspaceDirectory;
    await this.setFinish(taskId, { running: step, error: null });
    const run = async (): Promise<Partial<Finish>> => {
      if (step === "pr") {
        const reply = await this.host.askAgent(
          agentId!,
          pullRequestPrompt(task),
        );
        const text = parseTicket(reply, "pr");
        return { prTitle: text.title, prBody: text.description };
      }
      const dirty = await this.host.gitDirty(directory);
      if (step === "commit" && !dirty) {
        // CUSTOM(orchestrator-in-place): the agent may have committed already; a folder task
        // approves to "committed", not to a "Nothing to commit" error.
        if (this.store.current.orchestrations[taskId]?.inPlace)
          return { committedAt: this.stamp() };
        throw new Error("Nothing to commit");
      }
      const done: Partial<Finish> = {};
      if (dirty) {
        // CUSTOM(assistant-autonomy): never commit a dependency folder or symlink.
        const refusal = dependencyRefusal(
          await this.host.gitStatusLines(directory),
        );
        if (refusal) throw new Error(refusal);
        // CUSTOM(orchestrator-in-place): never sweep another running task's work into this
        // commit; the user can press Commit again when the folder is free.
        if (this.store.current.orchestrations[taskId]?.inPlace === true) {
          const occupant = this.runningFolderOccupant(taskId, directory);
          if (occupant)
            throw new Error(
              `Waiting: "${occupant}" is still running in ${directory}`,
            );
        }
        // CUSTOM(orchestrator-in-place): share the project's lock with deliveries and merges.
        if (this.store.current.orchestrations[taskId]?.inPlace === true)
          await this.mergeLock.run(this.projectIdOf(task) ?? directory, () =>
            this.host.commit(directory),
          );
        else await this.host.commit(directory);
        done.committedAt = this.stamp();
      }
      if (step === "merge") {
        await this.host.mergeToBase(directory);
        done.mergedAt = this.stamp();
      }
      return done;
    };
    void run()
      .then((done) => this.serial(() => this.setFinish(taskId, done)))
      .catch((error) =>
        this.serial(() => this.setFinish(taskId, { error: message(error) })),
      )
      .catch(() => undefined)
      .finally(() => this.changed(task.workspaceId!));
  }
  private setFinish(taskId: string, change: Partial<Finish>): Promise<void> {
    return this.store.update((data) => {
      data.finishes[taskId] = finishSchema.parse({
        ...data.finishes[taskId],
        running: null,
        ...change,
      });
    });
  }
  /**
   * `/write-ticket` in a refinement chat: ask the agent for the final ticket and, once its turn
   * ends, replace the draft's title and description with it. Resolves when the request is sent.
   */
  async writeTicket(agentId: string, focus: string): Promise<void> {
    const taskId = await this.serial(async () => {
      const entry = Object.entries(this.store.current.refinements).find(
        ([, refinement]) => refinement.agentId === agentId,
      );
      if (!entry) throw new Error("This chat is not a Workboard refinement");
      const task = this.task(entry[0]);
      if (task.workspaceId) throw new Error("The task already started");
      if (entry[1].status === "writing")
        throw new Error("The ticket is already being written");
      await this.setRefinement(entry[0], { status: "writing", error: null });
      return entry[0];
    });
    void this.host
      .runAgent(agentId, writeTicketPrompt(focus))
      .then((reply) =>
        this.serial(async () => {
          const ticket = parseTicket(reply);
          await this.store.update((data, descriptions) => {
            const current = data.tasks.find((t) => t.id === taskId);
            if (!current || current.workspaceId) return;
            if (ticket.title) current.title = ticket.title;
            descriptions.set(current.id, ticket.description);
            current.updatedAt = this.stamp(current.updatedAt);
          });
          await this.setRefinement(taskId, { status: "written" });
        }),
      )
      .catch((error) =>
        this.serial(() =>
          this.setRefinement(taskId, {
            status: "failed",
            error: message(error),
          }),
        ),
      )
      .catch(() => undefined);
  }
  /** Move a task that has a workspace to another group through its labels. */
  private async moveBound(taskId: string, stage: Stage): Promise<void> {
    const task = this.task(taskId);
    if (!task.workspaceId)
      throw new Error("Start work and bind a workspace first");
    const workspace = this.inventory.workspaces.find(
      (w) => w.id === task.workspaceId,
    );
    const moved = await this.transition(
      task.workspaceId,
      stage,
      statusLabels(
        workspace?.labels ??
          (await this.host.workspace(task.workspaceId))?.labels ??
          [],
        this.store.current.settings.groups,
      ),
    );
    this.inventory.workspaces = this.inventory.workspaces.map((w) =>
      w.id === moved.id ? moved : w,
    );
    await this.store.update((data) => {
      const current = data.tasks.find((t) => t.id === taskId)!;
      current.lastStage = stage;
      current.updatedAt = this.stamp(current.updatedAt);
      if (current.issue === "labels-conflict") current.issue = null;
    });
  }
  /**
   * The reviewer's answer to a Ready to review card: Done moves it to the first Done group;
   * Continue sends it back to Ready to start with feedback, and the orchestrator hands that to
   * the same agent on its next pass (right away when it is playing). Runs inside `serial`.
   */
  private async review(
    taskId: string,
    outcome: "done" | "continue",
    feedback: string,
    by: Exclude<HistoryActor, "orchestrator">, // CUSTOM(assistant-cards)
  ): Promise<void> {
    const task = this.task(taskId);
    if (task.binding) throw new Error("Workspace binding is still pending");
    if (!task.workspaceId)
      throw new Error("Start work and bind a workspace first");
    const target = orderedGroups(this.store.current.settings).find(
      (group) => group.kind === (outcome === "done" ? "done" : "ready"),
    );
    if (!target)
      throw new Error(
        outcome === "done"
          ? "Add a Done group first"
          : "Add a Ready to start group first",
      );
    await this.moveBound(taskId, target.id);
    await this.pipelineReviewed(taskId, outcome, by); // CUSTOM(factory)
    if (outcome === "done") {
      if (this.store.current.orchestrations[taskId])
        await this.setOrchestration(taskId, { feedback: null });
      // CUSTOM(orchestrator-in-place): approving a folder task commits it on the branch the
      // folder is on, through the delivery pipeline, so the folder stays busy until the commit
      // ends and a real failure goes to Needs you.
      if (this.isInPlace(taskId)) {
        const workspace = this.inventory.workspaces.find(
          (w) => w.id === task.workspaceId,
        );
        if (workspace?.projectKind === "git") {
          if (this.delivering.has(taskId)) return; // the running delivery finishes it
          if (await this.host.gitDirty(workspace.workspaceDirectory)) {
            await this.actionDelivery(taskId, "merge", "committing");
            this.launch(taskId);
            return;
          }
        }
      }
      await this.closeDelivery(taskId, by); // CUSTOM(projects-assistant)
      return;
    }
    // CUSTOM(projects-assistant): the task leaves Needs you when it goes back to its agent.
    if (this.store.current.assistant.deliveries[taskId])
      await this.store.update((data) => {
        delete data.assistant.deliveries[taskId];
      });
    await this.setOrchestration(taskId, {
      status: "queued",
      feedback: feedback.trim(),
      feedbackBy: by, // CUSTOM(assistant-cards)
      ask: null,
      error: null,
      finishedAt: this.stamp(),
      // CUSTOM(task-checkpoints): the reviewer's answer is not a checkpoint resume.
      checkpoint: false,
      resumeAt: null,
      waitingFor: null,
    });
    // CUSTOM(task-checkpoints): sending it back gives a stalled task a new budget of checkpoints.
    if (this.store.current.assistant.progress[taskId])
      await this.store.update((data) => {
        const progress = data.assistant.progress[taskId];
        if (progress) {
          progress.checkpoints = 0;
          progress.stalls = 0;
        }
      });
    this.changed(task.workspaceId);
    await this.orchestrate();
  }
  // CUSTOM(projects-assistant): the Project Manager engine. ----------------------------------
  /** CUSTOM(assistant-reports): a column's name as the board shows it. */
  private groupLabel(groupId: string): string {
    const group = this.store.current.settings.groups.find(
      (g) => g.id === groupId,
    );
    return group ? (group.name ?? group.label) : groupId;
  }
  private assistantOn(): boolean {
    return this.store.current.assistant.settings.enabled;
  }
  private projectIdOf(task: Task): string | null {
    return (
      task.projectId ??
      this.inventory.workspaces.find((w) => w.id === task.workspaceId)
        ?.projectId ??
      null
    );
  }
  private policy(
    projectId: string | null,
  ): ProjectPolicy & { action: Delivery["action"] } {
    const settings = this.store.current.assistant.settings;
    const own = projectId ? settings.projects[projectId] : undefined;
    return own ?? projectPolicySchema.parse({ action: settings.defaultAction });
  }
  /** Append to the history; a history failure never stops the engine. */
  private async record(
    taskId: string,
    kind: HistoryEventKind,
    text: string,
    extra: Partial<
      Pick<
        HistoryEventInput,
        "reason" | "detail" | "attempt" | "action" | "agentId" | "by"
      >
    > = {},
  ): Promise<void> {
    try {
      const data = this.store.current;
      const task = data.tasks.find((t) => t.id === taskId);
      if (!task || !this.assistantOptions.history) return;
      const run = data.orchestrations[taskId];
      const attempts = data.assistant.attempts[taskId] ?? [];
      const delivery = data.assistant.deliveries[taskId];
      const projectId = this.projectIdOf(task);
      const config = data.orchestrators.find(
        (o) => o.id === run?.orchestratorId,
      );
      await this.assistantOptions.history.append({
        kind,
        taskId,
        taskTitle: task.title,
        projectId,
        projectName:
          task.projectName ||
          this.inventory.projects.find((p) => p.id === projectId)?.name ||
          "",
        orchestratorId: run?.orchestratorId ?? null,
        orchestratorName: config?.name ?? null,
        agentId:
          extra.agentId !== undefined ? extra.agentId : (run?.agentId ?? null),
        attempt:
          extra.attempt !== undefined
            ? extra.attempt
            : (delivery?.attempt ?? attempts.at(-1)?.index ?? null),
        action:
          extra.action !== undefined
            ? extra.action
            : (delivery?.action ?? null),
        reason: extra.reason ?? null,
        text: text.slice(0, 2000),
        detail: extra.detail ?? null,
        by: extra.by ?? "orchestrator", // CUSTOM(assistant-cards)
        // CUSTOM(factory): the stamp of the run the event belongs to.
        factoryRevision: run?.factoryRevision ?? null,
        workerId: run?.workerId ?? null,
        workerConfigHash: run?.workerConfigHash ?? null,
      });
    } catch {
      // The history is a log; the board does not depend on it.
    }
  }
  /** Start an attempt, closing any attempt left open. Returns its index. */
  private async openAttempt(
    taskId: string,
    trigger: Attempt["trigger"],
    agentId: string | null,
    orchestratorId: string | null,
    feedback: string | null,
  ): Promise<number> {
    let index = 1;
    const at = this.stamp();
    await this.store.update((data) => {
      const list = (data.assistant.attempts[taskId] ??= []);
      for (const open of list)
        if (!open.finishedAt) {
          open.finishedAt = at;
          open.outcome = "failed";
        }
      index = (list.at(-1)?.index ?? 0) + 1;
      list.push(
        attemptSchema.parse({
          index,
          agentId,
          orchestratorId,
          startedAt: at,
          trigger,
          feedback,
        }),
      );
    });
    return index;
  }
  /** The open attempt of a task, created when none is (the task started before the assistant). */
  private async ensureAttempt(
    taskId: string,
    record: Orchestration,
  ): Promise<Attempt> {
    const last = this.store.current.assistant.attempts[taskId]?.at(-1);
    if (last && !last.finishedAt) return last;
    await this.openAttempt(
      taskId,
      "start",
      record.agentId,
      record.orchestratorId,
      null,
    );
    return this.store.current.assistant.attempts[taskId]!.at(-1)!;
  }
  /** Close the open attempt with an outcome. Returns its index. */
  private async closeAttempt(
    taskId: string,
    outcome: AttemptOutcome,
    record: Orchestration,
  ): Promise<number> {
    await this.ensureAttempt(taskId, record);
    const at = this.stamp();
    let index = 1;
    await this.store.update((data) => {
      const last = data.assistant.attempts[taskId]!.at(-1)!;
      index = last.index;
      if (last.finishedAt) return;
      last.finishedAt = at;
      last.outcome = outcome;
    });
    return index;
  }
  private patchDelivery(
    taskId: string,
    change: Partial<Delivery>,
  ): Promise<void> {
    if (change.stage && change.stage !== "merging")
      this.clearDirtyTimer(taskId); // CUSTOM(assistant-autonomy)
    if (change.stage) {
      this.clearFolderTimer(taskId); // CUSTOM(orchestrator-in-place)
      this.loggedFolderCommitWaits.delete(taskId);
    }
    return this.store.update((data) => {
      const delivery = data.assistant.deliveries[taskId];
      if (!delivery) return;
      data.assistant.deliveries[taskId] = {
        ...delivery,
        ...change,
        updatedAt: this.stamp(delivery.updatedAt),
      };
    });
  }
  /** Puts the task on Needs you. Runs inside `serial` (or from a caller that is). */
  private async markNeedsYou(
    taskId: string,
    reason: NeedsYouReason,
    detail: string | null,
  ): Promise<void> {
    if (!this.store.current.assistant.deliveries[taskId]) return;
    await this.patchDelivery(taskId, {
      stage: "needs-you",
      reason,
      detail,
      toldAt: null, // CUSTOM(assistant-wake)
      firstToldAt: null, // CUSTOM(assistant-wake)
      // CUSTOM(assistant-wake): a new wait is a new event, even for a task reported before.
      reportedAt: null,
      remindedAt: null,
    });
    await this.record(taskId, "needs-you", `Needs you: ${reason}`, {
      reason,
      detail,
    });
    // CUSTOM(assistant-wake)
    if (
      this.store.current.assistant.settings.chat.wakeOnNeedsYou &&
      !this.userGate(taskId) // CUSTOM(factory)
    ) {
      this.wakePending.add(taskId);
      this.armWake();
    }
  }
  /**
   * CUSTOM(factory): the task waits on a pipeline gate, or on a stage choice the Project Manager
   * asked the user about (board_pipeline_ask). Only the user answers those (in Decisões), so the
   * PM is not woken for them. A `when` list's choice with no card yet wakes the PM (ticket 12).
   */
  private userGate(taskId: string): boolean {
    const delivery = this.store.current.assistant.deliveries[taskId];
    const gate = this.store.current.tasks.find((t) => t.id === taskId)?.pipeline
      ?.gate;
    return (
      delivery?.stage === "needs-you" &&
      delivery.reason === "gate" &&
      !!gate &&
      (gate.kind === "gate" || gate.cardId !== null) &&
      this.factoryMode() === "active"
    );
  }
  /** CUSTOM(unattended-automation): a hidden board subagent of this task waits on a permission. */
  private waitingBoardChild(parentAgentId: string | null): boolean {
    if (!parentAgentId) return false;
    return this.inventory.agents.some(
      (candidate) =>
        candidate.parentAgentId === parentAgentId &&
        candidate.waitingPermission === true &&
        candidate.labels?.[BOARD_AGENT_LABEL] === "true",
    );
  }
  /**
   * CUSTOM(unattended-automation): layer C. An automatic agent stuck on a permission goes to
   * Needs you with the reason and wakes the Project Manager. The delivery is created only
   * when none exists; a task in a delivery step keeps its step.
   */
  private async permissionNeedsYou(
    taskId: string,
    record: Orchestration,
    task: Task,
    since: string,
  ): Promise<void> {
    const delivery = this.store.current.assistant.deliveries[taskId];
    await this.setOrchestration(taskId, { permissionNeedsYou: true });
    if (delivery) {
      // A delivery step (a fix, a merge) owns the task; changing its stage would break
      // its resume. Leave the step alone but record why the agent is not moving.
      await this.log(
        record.orchestratorId,
        "warn",
        `"${task.title}" is waiting for a permission during its delivery`,
        taskId,
        record.agentId,
      );
      return;
    }
    const { index: attempt } = await this.ensureAttempt(taskId, record);
    await this.createDelivery(taskId, {
      action: this.policy(this.projectIdOf(task)).action,
      attempt,
    });
    const minutes = Math.max(
      1,
      Math.round((this.now() - Date.parse(since)) / 60_000),
    );
    await this.markNeedsYou(
      taskId,
      "permission",
      `The agent has been waiting for a permission for ${minutes} min.`,
    );
    await this.log(
      record.orchestratorId,
      "warn",
      `"${task.title}" is waiting for a permission`,
      taskId,
      record.agentId,
    );
  }
  /** CUSTOM(unattended-automation): the wait ended; drop a Needs you this board raised. */
  private async clearPermissionWait(taskId: string): Promise<void> {
    const delivery = this.store.current.assistant.deliveries[taskId];
    await this.setOrchestration(taskId, {
      permissionSince: null,
      permissionNeedsYou: false,
    });
    if (
      delivery?.stage === "needs-you" &&
      delivery.reason === "permission" &&
      !delivery.report
    )
      await this.store.update((data) => {
        delete data.assistant.deliveries[taskId];
      });
  }
  // CUSTOM(assistant-wake): tasks that need the user are told to the chat agent in one batch.
  private wakePending = new Set<string>();
  /** Tasks in the prompt being sent; their `toldAt` is not stored yet. */
  private wakeSending = new Set<string>();
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  /** CUSTOM(assistant-wake): when `wakeTimer` fires, for the dashboard countdown. */
  private wakeDueAt: number | null = null;
  /** CUSTOM(assistant-wake): the last time the chat was told a Needs you list. */
  private lastToldAt = 0;
  /**
   * The queue lives in memory, so a new Workboard (plugin reload, daemon restart) starts
   * empty. Put back every needs-you task the chat was not told about yet, and remind it once
   * about one that has waited NEEDS_YOU_REMIND_MS with no board_report or action.
   */
  private requeueUntold(): void {
    const { settings, chatAgentId, deliveries } = this.store.current.assistant;
    if (!settings.chat.wakeOnNeedsYou || !chatAgentId) return;
    let added = false;
    for (const [taskId, delivery] of Object.entries(deliveries)) {
      if (
        delivery.stage !== "needs-you" ||
        this.wakePending.has(taskId) ||
        this.wakeSending.has(taskId) ||
        !this.store.current.tasks.some((t) => t.id === taskId) ||
        this.userGate(taskId) // CUSTOM(factory)
      )
        continue;
      if (!delivery.toldAt) {
        this.wakePending.add(taskId);
        added = true;
        continue;
      }
      // CUSTOM(assistant-wake): told but ignored: one reminder after the wait.
      if (
        delivery.remindedAt ||
        this.reportedSince(delivery) ||
        this.now() - Date.parse(delivery.toldAt) < NEEDS_YOU_REMIND_MS
      )
        continue;
      this.wakePending.add(taskId);
      added = true;
    }
    // A timer already armed takes the new tasks with it; re-arming would push it back.
    if (added && !this.wakeTimer) this.armWake();
  }
  /** CUSTOM(assistant-wake): the assistant recorded an action after it first heard of the wait. */
  private reportedSince(delivery: Delivery): boolean {
    const first = delivery.firstToldAt ?? delivery.toldAt;
    if (!delivery.reportedAt || !first) return false;
    return Date.parse(delivery.reportedAt) >= Date.parse(first);
  }
  /** CUSTOM(assistant-wake): the setting's seconds; tests may override the wait directly. */
  private wakeDelay(): number {
    if (this.assistantOptions.wakeDelayMs !== undefined)
      return this.assistantOptions.wakeDelayMs;
    const seconds = this.store.current.assistant.settings.chat.wakeDelaySeconds;
    return Number.isFinite(seconds)
      ? seconds * 1000
      : DEFAULT_WAKE_DELAY_SECONDS * 1000;
  }
  private armWake(delayMs = this.wakeDelay()): void {
    if (this.stopped) return;
    clearTimeout(this.wakeTimer);
    const delay = Math.max(delayMs, this.wakeWait()); // CUSTOM(usage-limit)
    this.wakeDueAt = this.now() + delay;
    this.wakeTimer = setTimeout(() => void this.wakeAssistant(), delay);
  }
  /**
   * CUSTOM(assistant-wake): every task still on Needs you, oldest wait first, with its reason and
   * since when. A wake carries all of them, not only the new ones, so a task told before and left
   * waiting is never out of the assistant's view.
   */
  private needsYouEntries(): { id: string; task: Task; delivery: Delivery }[] {
    const entries: { id: string; task: Task; delivery: Delivery }[] = [];
    for (const [id, delivery] of Object.entries(
      this.store.current.assistant.deliveries,
    )) {
      if (delivery.stage !== "needs-you") continue;
      const task = this.store.current.tasks.find((t) => t.id === id);
      if (
        !task ||
        task.archived?.status === "archived" ||
        task.archived?.status === "external" ||
        this.userGate(id) // CUSTOM(factory)
      )
        continue;
      entries.push({ id, task, delivery });
    }
    return entries.sort(
      (left, right) =>
        Date.parse(left.delivery.updatedAt) -
        Date.parse(right.delivery.updatedAt),
    );
  }
  private needsYouLine({
    id,
    task,
    delivery,
  }: {
    id: string;
    task: Task;
    delivery: Delivery;
  }): string {
    const project =
      task.projectName ||
      this.inventory.projects.find((p) => p.id === this.projectIdOf(task))
        ?.name ||
      "";
    const clean = (value: string, max: number) => {
      const line = value.replace(/\s+/g, " ").trim();
      return line.length > max ? `${line.slice(0, max)}...` : line;
    };
    const reason = delivery.reason ?? "unknown";
    const projectId = this.projectIdOf(task);
    const line = [
      id,
      clean(task.title, 200),
      clean(project, 100),
      delivery.detail ? `${reason}: ${clean(delivery.detail, 300)}` : reason,
      `pipeline: ${this.projectPipelineId(projectId)}`,
      this.autonomyRule(projectId), // CUSTOM(factory)
      `waiting since ${delivery.updatedAt} (${this.waitFor(delivery.updatedAt)})`,
      ...(task.number > 0 ? [`#${task.number}`] : []), // CUSTOM(task-numbers)
    ].join(" | ");
    return [line, ...this.pipelineChoiceLines(task, delivery)].join("\n");
  }
  /** CUSTOM(assistant-wake): "6 min", "2 h 5 min", for the prompt. */
  private waitFor(since: string): string {
    const ms = Math.max(0, this.now() - Date.parse(since));
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  /**
   * CUSTOM(assistant-wake): the Needs you list that goes with a message that wakes the chat
   * (quick message, user message, board wake).
   */
  assistantNeedsYouBrief(): { text: string; ids: string[] } {
    const entries = this.needsYouEntries();
    return {
      text: entries.map((entry) => `- ${this.needsYouLine(entry)}`).join("\n"),
      ids: entries.map((entry) => entry.id),
    };
  }
  /** CUSTOM(assistant-wake): the chat was told these tasks; a reminder is still possible. */
  async markAssistantTold(ids: string[]): Promise<void> {
    if (!ids.length) return;
    // A reminder already queued is satisfied by this message; don't send it again.
    const reminded = ids.filter(
      (id) =>
        this.wakePending.has(id) &&
        !!this.store.current.assistant.deliveries[id]?.toldAt,
    );
    for (const id of ids) this.wakePending.delete(id);
    // Set before the store write so a turn that starts right after does not get it twice.
    this.lastToldAt = this.now();
    const at = this.stamp();
    await this.store.update((data) => {
      for (const id of ids) {
        const delivery = data.assistant.deliveries[id];
        if (delivery?.stage !== "needs-you") continue;
        delivery.toldAt = at;
        delivery.firstToldAt ??= at;
        if (reminded.includes(id)) delivery.remindedAt = at;
      }
    });
  }
  /**
   * CUSTOM(assistant-wake): these tasks are on their way to the chat (a quick message). Its turn
   * may start before the send resolves; `chatTurnStarted` must not repeat the same list. Returns
   * the release to call once the message landed and `markAssistantTold` ran.
   */
  markAssistantSending(ids: string[]): () => void {
    for (const id of ids) this.wakeSending.add(id);
    return () => {
      for (const id of ids) this.wakeSending.delete(id);
    };
  }
  /** CUSTOM(assistant-wake): board_report counts as handling the task for the reminder. */
  async noteAssistantReported(taskId: string): Promise<void> {
    if (!this.store.current.assistant.deliveries[taskId]) return;
    const at = this.stamp();
    // Not `patchDelivery`: `updatedAt` is the "waiting since" the prompt shows.
    await this.store.update((data) => {
      const delivery = data.assistant.deliveries[taskId];
      if (delivery) delivery.reportedAt = at;
    });
  }
  /**
   * CUSTOM(assistant-wake): a message from the user started the chat's turn. If tasks wait and
   * were not told recently, steer the same list in so the reply handles them too. A board wake
   * or quick message sets `toldAt` right before its turn, so it is not repeated here.
   */
  chatTurnStarted(agentId: string): void {
    this.tellReloadFailure(agentId);
    const assistant = this.store.current.assistant;
    if (
      !assistant.settings.chat.wakeOnNeedsYou ||
      assistant.chatAgentId !== agentId ||
      this.wakeSending.size > 0 ||
      // A board wake or a quick message just told it; its turn is starting now.
      this.now() - this.lastToldAt < CHAT_TURN_REMIND_MS
    )
      return;
    const entries = this.needsYouEntries().filter(({ delivery }) => {
      if (!delivery.toldAt) return true;
      return this.now() - Date.parse(delivery.toldAt) >= CHAT_TURN_REMIND_MS;
    });
    if (!entries.length) return;
    const lines = entries.map((entry) => `- ${this.needsYouLine(entry)}`);
    const previous = this.lastToldAt;
    this.lastToldAt = this.now();
    void this.host
      .steerAgent(
        agentId,
        [
          "[Needs you] These tasks still wait for you. Handle them before you end this reply (review and merge-now, continue, answer, or dismiss), or say why they must wait for the user:",
          ...lines,
        ].join("\n"),
      )
      .then(() => this.markAssistantTold(entries.map((entry) => entry.id)))
      .catch((error) => {
        // Nothing was delivered: let the next turn try again.
        this.lastToldAt = previous;
        console.error(
          "Could not tell the assistant about Needs you:",
          message(error),
        );
      });
  }
  /** CUSTOM(assistant-wake): board_reload_plugin defers the reload to the end of this turn. */
  private reloadAfterTurn = false;
  /** CUSTOM(assistant-wake): the next look at a chat that still read busy when its turn ended. */
  private reloadTimer?: ReturnType<typeof setTimeout>;
  private reloadTries = 0;
  /** CUSTOM(assistant-wake): why the last deferred reload failed; the chat's next turn hears it. */
  private reloadFailure: string | null = null;
  requestPluginReload(): boolean {
    if (!this.store.current.assistant.chatAgentId) return false;
    this.reloadAfterTurn = true;
    this.reloadFailure = null;
    return true;
  }
  /**
   * CUSTOM(assistant-wake): the chat's turn ended. A deferred plugin reload runs now, so the
   * board tools stay attached for the whole turn and the next prompt opens a fresh session.
   */
  chatTurnEnded(agentId: string): void {
    if (
      !this.reloadAfterTurn ||
      agentId !== this.store.current.assistant.chatAgentId
    )
      return;
    clearTimeout(this.reloadTimer);
    this.reloadTries = 0;
    void this.reloadPluginWhenIdle(agentId);
  }
  private reloadStillWanted(agentId: string): boolean {
    return (
      !this.stopped &&
      this.reloadAfterTurn &&
      agentId === this.store.current.assistant.chatAgentId
    );
  }
  private async reloadPluginWhenIdle(agentId: string): Promise<void> {
    this.reloadTimer = undefined;
    if (!this.reloadStillWanted(agentId)) return;
    const activity = await this.host.agentActivity(agentId);
    if (!this.reloadStillWanted(agentId) || activity === null) return;
    // A finished turn reads "attention" until the user opens the chat (or "error"): only a
    // running turn or a permission prompt holds the reload, which would retire its tools.
    if (activity === "running" || activity === "waiting") {
      // The turn's end reaches plugins before the daemon marks the chat idle, and an
      // interrupted turn ends right before the one that replaces it. Look again for a short
      // while; after that the flag waits for the next end.
      if (this.reloadTries++ < RELOAD_RETRIES)
        this.reloadTimer = setTimeout(
          () => void this.reloadPluginWhenIdle(agentId),
          this.assistantOptions.reloadRetryMs ?? RELOAD_RETRY_MS,
        );
      return;
    }
    this.reloadAfterTurn = false;
    try {
      await this.host.reloadPlugin();
    } catch (error) {
      // The daemon stops this process to reload it, and stopping closes the bridge under the
      // pending request: that rejection is the reload working.
      if (this.stopped) return;
      this.reloadFailure = message(error);
      console.error("Could not reload the plugin:", this.reloadFailure);
    }
  }
  /** CUSTOM(assistant-wake): a deferred reload failed; tell the chat in the turn that starts. */
  private tellReloadFailure(agentId: string): void {
    const failure = this.reloadFailure;
    if (!failure || agentId !== this.store.current.assistant.chatAgentId)
      return;
    this.reloadFailure = null;
    void this.host
      .steerAgent(
        agentId,
        `[Plugin reload] The reload board_reload_plugin asked for failed: ${failure}. The board still runs its old code. Call board_reload_plugin again at the end of this reply; if it fails again, tell the user.`,
      )
      .catch((error) => {
        this.reloadFailure ??= failure;
        console.error(
          "Could not tell the assistant the plugin reload failed:",
          message(error),
        );
      });
  }
  /** CUSTOM(usage-limit): how long the chat still waits for its usage limit to reset; 0 when it doesn't. */
  private wakeWait(): number {
    const assistant = this.store.current.assistant;
    // Scoped per agent: a wait stored for a chat the user replaced does not hold the new one.
    if (
      assistant.wakeAgentId &&
      assistant.wakeAgentId !== assistant.chatAgentId
    )
      return 0;
    const at = Date.parse(assistant.wakeAt ?? "");
    return Number.isFinite(at) ? Math.max(0, at - this.now()) : 0;
  }
  /** CUSTOM(usage-limit): a `checkWakeTurn` is running. */
  private wakeChecking = false;
  /**
   * CUSTOM(usage-limit): once the turn of the last wake has ended, see whether it ended on the
   * plan's usage limit. Then the chat never read it: its tasks lose `toldAt` and the next wake
   * waits until just after the reset (`wakeAt`). Runs at start and on each refresh while a wake
   * turn is open; the turn is stored, so a restart in between still checks it. `ended`: the
   * caller saw the chat idle, so the turn is over however recent the wake.
   */
  private async checkWakeTurn(ended = false): Promise<void> {
    const turn = this.store.current.assistant.wakeTurn;
    if (!turn || this.wakeChecking || this.stopped) return;
    // A turn of a chat the user replaced belongs to that chat: it is not read, and its reset
    // must not hold the current chat.
    if (this.store.current.assistant.chatAgentId !== turn.agentId) {
      const at = turn.toldAt;
      await this.store.update((data) => {
        if (data.assistant.wakeTurn?.toldAt !== at) return;
        data.assistant.wakeTurn = null;
        data.assistant.wakeAt = null;
        data.assistant.wakeAgentId = null;
        // The replaced chat may never have read it; the current chat is told instead.
        for (const id of turn.taskIds) {
          const delivery = data.assistant.deliveries[id];
          if (delivery?.stage === "needs-you" && delivery.toldAt === at) {
            delivery.toldAt = null;
            delivery.firstToldAt = null;
          }
        }
      });
      this.requeueUntold();
      if (this.wakePending.size) this.armWake();
      return;
    }
    // Give the turn time to start, so the reply read is the answer to the wake.
    if (!ended && this.now() - Date.parse(turn.toldAt) < WAKE_TURN_START_MS)
      return;
    this.wakeChecking = true;
    try {
      const activity = await this.host.agentActivity(turn.agentId);
      if (activity === "running" || activity === "waiting") return;
      const reply =
        activity === null ? null : await this.host.lastReply(turn.agentId);
      // The notice came right after the wake, so the wake's time dates it.
      const wakeAt = usageLimitResumeAt(
        reply,
        this.now(),
        Date.parse(turn.toldAt),
      );
      let requeued = false;
      await this.store.update((data) => {
        if (data.assistant.wakeTurn?.toldAt !== turn.toldAt) return;
        data.assistant.wakeTurn = null;
        if (!wakeAt) {
          data.assistant.wakeAt = null;
          data.assistant.wakeAgentId = null;
          return;
        }
        data.assistant.wakeAt = wakeAt;
        data.assistant.wakeAgentId = turn.agentId;
        for (const id of turn.taskIds) {
          const delivery = data.assistant.deliveries[id];
          if (
            delivery?.stage === "needs-you" &&
            delivery.toldAt === turn.toldAt
          ) {
            delivery.toldAt = null;
            delivery.firstToldAt = null;
            requeued = true;
          }
        }
      });
      if (!wakeAt || !requeued) return;
      await this.record(
        turn.taskIds[0]!,
        "usage-limit",
        `The assistant hit the usage limit; it will be told again at ${wakeAt}`,
        { agentId: turn.agentId, detail: reply },
      );
      this.requeueUntold();
    } catch (error) {
      console.error(
        "Could not check the assistant's wake turn:",
        message(error),
      );
    } finally {
      this.wakeChecking = false;
    }
  }
  private async wakeAssistant(): Promise<void> {
    this.wakeTimer = undefined;
    this.wakeDueAt = null;
    if (this.stopped) return;
    let sending: string[] = [];
    let previousToldAt = 0;
    let advancedToldAt = false;
    try {
      const assistant = this.store.current.assistant;
      const agentId = assistant.chatAgentId;
      // No chat, or it was turned off: the dashboard still shows the tasks.
      const activity =
        assistant.settings.chat.wakeOnNeedsYou && agentId
          ? await this.host.agentActivity(agentId)
          : null;
      if (!agentId || activity === null) {
        this.wakePending.clear();
        return;
      }
      // Never interrupt it: look again soon, so the batch lands on the first idle moment.
      if (activity === "running" || activity === "waiting") {
        this.armWake(
          Math.min(
            this.assistantOptions.wakeDelayMs ?? BUSY_WAKE_RETRY_MS,
            BUSY_WAKE_RETRY_MS,
          ),
        );
        return;
      }
      // CUSTOM(usage-limit): read the last wake's turn first, so this wake does not replace it
      // unread; then, if the chat is still on its usage limit, the tasks wait for the reset.
      if (this.wakeChecking) {
        this.armWake();
        return;
      }
      await this.checkWakeTurn(true);
      if (this.wakeWait() > 0) {
        this.armWake();
        return;
      }
      // CUSTOM(assistant-wake): the prompt lists every task still waiting, not only the new ones.
      const pending = new Set(this.wakePending);
      this.wakePending.clear();
      if (!pending.size) return;
      const tasks = this.needsYouEntries();
      // Nothing left that triggered this wake (the task was handled or dismissed).
      if (!tasks.some((entry) => pending.has(entry.id))) return;
      const reminded = new Set(
        tasks
          .filter((entry) => pending.has(entry.id) && entry.delivery.toldAt)
          .map((entry) => entry.id),
      );
      sending = tasks.map((entry) => entry.id);
      for (const id of sending) this.wakeSending.add(id);
      const lines = tasks.map((entry) => this.needsYouLine(entry));
      // Before the send: the turn starts while it is in flight.
      previousToldAt = this.lastToldAt;
      advancedToldAt = true;
      this.lastToldAt = this.now();
      await this.host.sendAgent(
        agentId,
        [
          "[Board] These tasks finished or stopped and wait for you, the Project Manager, first:",
          "This list is every task still on Needs you, including ones you were told about before and left waiting.",
          ...lines,
          WAKE_INSTRUCTIONS, // CUSTOM(factory)
        ].join("\n"),
      );
      const toldAt = this.stamp();
      await this.store.update((data) => {
        for (const { id } of tasks) {
          const delivery = data.assistant.deliveries[id];
          if (delivery?.stage === "needs-you") {
            delivery.toldAt = toldAt;
            delivery.firstToldAt ??= toldAt;
            if (reminded.has(id)) delivery.remindedAt = toldAt;
          }
        }
        // CUSTOM(usage-limit): watch this turn in case it ends on the usage limit.
        data.assistant.wakeAt = null;
        data.assistant.wakeAgentId = null;
        data.assistant.wakeTurn = {
          agentId,
          toldAt,
          taskIds: tasks.map((entry) => entry.id),
        };
      });
      await this.record(
        tasks[0]!.id,
        "told-assistant",
        `Told the assistant: ${tasks.length} task${tasks.length === 1 ? "" : "s"} wait for it`,
        {
          agentId,
          detail: tasks.map((entry) => entry.task.title).join("\n"),
        },
      );
    } catch (error) {
      // Nothing reached the chat: let the next user turn steer the list in.
      if (advancedToldAt) this.lastToldAt = previousToldAt;
      // A task whose `toldAt` was not stored goes back on the next refresh.
      console.error("Could not tell the assistant:", message(error));
    } finally {
      for (const id of sending) this.wakeSending.delete(id);
    }
  }
  private async createDelivery(
    taskId: string,
    init: Partial<Delivery> & Pick<Delivery, "action" | "attempt">,
  ): Promise<void> {
    const at = this.stamp();
    this.clearDirtyTimer(taskId); // CUSTOM(assistant-autonomy)
    await this.store.update((data) => {
      data.assistant.deliveries[taskId] = deliverySchema.parse({
        stage: "reported",
        observe: false,
        startedAt: at,
        updatedAt: at,
        ...init,
      });
    });
  }
  /**
   * The agent's turn ended: read its report, store the summary without the block, create the
   * delivery and settle everything that needs no git work. Returns whether an asynchronous
   * delivery step (verify, merge or PR) must run. Runs inside `serial`.
   */
  private async assistantFinished(
    taskId: string,
    record: Orchestration,
    reply: string | null,
  ): Promise<boolean> {
    const task = this.task(taskId);
    const parsed = reply ? parseReport(reply) : { report: null, text: "" };
    const report = parsed.report;
    const summary = parsed.text || report?.summary || "";
    const ask = askOf(report); // CUSTOM(assistant-cards)
    if (summary || ask || record.ask)
      await this.setOrchestration(taskId, {
        ...(summary ? { summary } : {}),
        ask,
      });
    const attempt = await this.closeAttempt(
      taskId,
      report ? report.status : "no-report",
      record,
    );
    // CUSTOM(task-checkpoints): a checkpoint resumes the task unless it stalled.
    if (report?.status === "checkpoint") {
      const stalled = await this.checkpointReached(
        taskId,
        record,
        report,
        attempt,
      );
      if (stalled === null) return false;
      await this.createDelivery(taskId, {
        action: this.policy(this.projectIdOf(task)).action,
        attempt,
        report,
      });
      return this.settle(taskId, "stalled", stalled);
    }
    const policy = this.policy(this.projectIdOf(task));
    const previous = this.store.current.assistant.deliveries[taskId];
    const afterFix = previous?.stage === "fixing" ? previous : null;
    // CUSTOM(assistant-autonomy): a merge that went back to the agent (a failed check or a
    // conflict) returns to merging whatever the policy says; it was already approved.
    const resumeMerge = afterFix?.action === "merge";
    const action = resumeMerge ? "merge" : policy.action;
    const observe = resumeMerge ? false : policy.observe;
    await this.createDelivery(taskId, {
      action,
      observe,
      attempt,
      report,
      fixesUsed: afterFix?.fixesUsed ?? 0,
      conflictFixes: afterFix?.conflictFixes ?? 0,
      verifyOutput: afterFix?.verifyOutput ?? null,
    });
    await this.record(
      taskId,
      "report",
      report
        ? `Reported ${report.status}: ${report.summary.split("\n")[0].slice(0, 200)}`
        : "Finished without a valid report",
      { attempt, detail: summary || null },
    );
    if (!report) return this.settle(taskId, "no-report", null);
    if (report.status === "blocked")
      return this.settle(taskId, "blocked", report.question);
    if (report.status === "needs_input")
      return this.settle(taskId, "needs-input", report.question);
    if (report.status === "failed") {
      await this.record(taskId, "failed", "The agent reported it failed", {
        attempt,
        detail: report.question,
      });
      return this.settle(taskId, "failed", report.question);
    }
    // CUSTOM(factory): a pipeline stage that reported done goes where its pipeline says.
    const routed = await this.pipelineStageDone(taskId, report);
    if (routed !== null) return routed;
    return this.deliverDone(taskId, action, observe);
  }
  /**
   * Today's delivery of a done report, from the action on. Returns whether an asynchronous step
   * (verify, merge or PR) must run. Inside `serial`.
   */
  private async deliverDone(
    taskId: string,
    action: Delivery["action"],
    observe: boolean,
  ): Promise<boolean> {
    const task = this.task(taskId);
    const policy = this.policy(this.projectIdOf(task));
    if (action === "nothing") {
      // CUSTOM(orchestrator-in-place): a folder task in review keeps the folder until the user
      // approves it, marks it done or dismisses it.
      if (!this.isInPlace(taskId))
        await this.patchDelivery(taskId, { stage: "delivered" });
      return false;
    }
    if (action === "notify") return this.settle(taskId, "notify", null);
    // CUSTOM(assistant-autonomy): like notify, but the assistant chat reviews and merges it.
    if (action === "review") return this.settle(taskId, "review", null);
    if (observe) {
      const would = action === "merge" ? "Would merge" : "Would prepare a PR";
      await this.record(taskId, "observed", would, { detail: would });
      return this.settle(taskId, "observed", would);
    }
    if (action === "prepare-pr") {
      await this.patchDelivery(taskId, { stage: "preparing-pr" });
      return true;
    }
    const workspace = this.inventory.workspaces.find(
      (w) => w.id === task.workspaceId,
    );
    if (workspace?.projectKind !== "git")
      return this.settle(
        taskId,
        "merge-error",
        "This task's project is not a git repository",
      );
    await this.patchDelivery(taskId, {
      stage: this.needsVerification(task, policy) ? "verifying" : "committing",
    });
    return true;
  }
  // CUSTOM(task-checkpoints) -----------------------------------------------------------------
  /**
   * A checkpoint report: save the checklist, commit the partial work in the worktree and queue
   * the task to resume (at `resumeAfter` when given). Returns why it stalled, or null when it will
   * resume. Inside `serial`.
   */
  private async checkpointReached(
    taskId: string,
    record: Orchestration,
    report: Report,
    attempt: number,
  ): Promise<string | null> {
    const task = this.task(taskId);
    const previous = this.store.current.assistant.progress[taskId];
    const done = report.progress?.done ?? previous?.done ?? [];
    const next = report.progress?.next ?? previous?.next ?? [];
    const key = (item: string) => item.trim().toLowerCase();
    const known = new Set((previous?.done ?? []).map(key));
    const advanced = done.some((item) => !known.has(key(item)));
    const checkpoints = (previous?.checkpoints ?? 0) + 1;
    // Waiting for something (CI, a review) is not a stall; the checkpoint limit still applies.
    const stalls = advanced
      ? 0
      : report.waitingFor?.trim()
        ? (previous?.stalls ?? 0)
        : (previous?.stalls ?? 0) + 1;
    const commit = await this.commitCheckpoint(task);
    const first = report.summary.split("\n")[0].slice(0, 300);
    const at = this.stamp();
    await this.store.update((data) => {
      const old = data.assistant.progress[taskId];
      data.assistant.progress[taskId] = taskProgressSchema.parse({
        done,
        next,
        checkpoints,
        stalls,
        summary: report.summary,
        log: [
          ...(old?.log ?? []),
          {
            at,
            checkpoint: checkpoints,
            text: commit ? `${first} (${commit})` : first,
          },
        ].slice(-CHECKPOINT_LOG_LIMIT),
        updatedAt: at,
      });
    });
    const max =
      this.store.current.orchestrators.find(
        (o) => o.id === record.orchestratorId,
      )?.maxCheckpoints ?? DEFAULT_MAX_CHECKPOINTS;
    const total = done.length + next.length;
    await this.record(
      taskId,
      "checkpoint",
      `Checkpoint ${checkpoints}${total ? ` (${done.length}/${total})` : ""}: ${first}`,
      { attempt, detail: commit },
    );
    const stalled =
      checkpoints > max
        ? `Checkpoint ${checkpoints}: over the limit of ${max} automatic resumes`
        : stalls >= STALL_LIMIT
          ? `${stalls} checkpoints in a row completed no new item`
          : null;
    if (stalled) return stalled;
    // A late checkpoint may follow a no-report that already asked for the user, and one sent
    // during an auto-fix ends that fix: neither may hold a pool slot or show while it waits.
    const open = this.store.current.assistant.deliveries[taskId]?.stage;
    if (open === "needs-you" || open === "fixing")
      await this.store.update((data) => {
        delete data.assistant.deliveries[taskId];
      });
    // A late checkpoint (after a no-report) or one during an auto-fix finds the card in review.
    const groups = this.store.current.settings.groups;
    const back = defaultStartWorkGroup(
      groups,
      this.store.current.settings.defaultStartWorkGroup,
    );
    if (groupKind(this.currentStage(task), groups) !== "in-progress" && back)
      await this.moveBound(taskId, back).catch((error) =>
        this.log(
          record.orchestratorId,
          "warn",
          `"${task.title}": could not move it back to In progress: ${message(error)}`,
          taskId,
          record.agentId,
        ),
      );
    const resumeAt = this.resumeTime(report.resumeAfter);
    await this.setOrchestration(taskId, {
      status: resumeAt ? "waiting" : "queued",
      checkpoint: true,
      resumeAt,
      waitingFor: report.waitingFor?.trim() || null,
      feedback: null,
      error: null,
    });
    await this.log(
      record.orchestratorId,
      "info",
      `"${task.title}": checkpoint ${checkpoints}/${max}; ${
        resumeAt ? `resumes at ${resumeAt}` : "resumes on the next pass"
      }${report.waitingFor?.trim() ? ` (waiting for ${report.waitingFor.trim()})` : ""}`,
      taskId,
      record.agentId,
    );
    return null;
  }
  /** A future time from `resumeAfter`, or null (resume on the next pass). */
  private resumeTime(value: string | null): string | null {
    if (!value) return null;
    const at = Date.parse(value);
    if (!Number.isFinite(at) || at <= this.now()) return null;
    return new Date(
      Math.min(at, this.now() + MAX_RESUME_DELAY_MS),
    ).toISOString();
  }
  /**
   * Commit the task's partial work in its own worktree, never on the base branch. Returns a note
   * for the log, or null when there was nothing to commit.
   */
  private async commitCheckpoint(task: Task): Promise<string | null> {
    const workspace = this.inventory.workspaces.find(
      (w) => w.id === task.workspaceId,
    );
    if (workspace?.projectKind !== "git") return null;
    // Only a task's own worktree: a task run in the project checkout shares the user's branch.
    if (workspace.workspaceKind !== "worktree")
      return "not committed: the task does not run in a worktree";
    const directory = workspace.workspaceDirectory;
    try {
      if (!(await this.host.gitDirty(directory))) return null;
      const refusal = dependencyRefusal(
        await this.host.gitStatusLines(directory),
      );
      if (refusal) return "not committed: dependency paths are untracked";
      await this.host.commit(directory);
      return "committed";
    } catch (error) {
      return `not committed: ${message(error)}`;
    }
  }
  /** Whether a queued or waiting task may continue now. */
  private resumable(record: Orchestration | undefined): boolean {
    if (record?.status === "queued") return true;
    return (
      record?.status === "waiting" &&
      (!record.resumeAt || Date.parse(record.resumeAt) <= this.now())
    );
  }
  /** The column a task's card is in, read from its workspace labels like the snapshot does. */
  private currentStage(task: Task): string {
    const workspace = this.inventory.workspaces.find(
      (w) => w.id === task.workspaceId,
    );
    return workspace
      ? resolveStage(
          workspace.labels,
          this.store.current.settings.groups,
          this.store.current.settings.defaultStartGroup,
        )
      : task.lastStage;
  }
  /** The branch of the task's worktree, or null when unknown. */
  private async taskBranch(task: Task): Promise<string | null> {
    const workspace = this.inventory.workspaces.find(
      (w) => w.id === task.workspaceId,
    );
    if (!workspace) return null;
    return this.host
      .currentBranch(workspace.workspaceDirectory)
      .catch(() => null);
  }
  // End CUSTOM(task-checkpoints) -------------------------------------------------------------
  /**
   * CUSTOM(usage-limit): the agent's turn ended on the plan's usage limit (`text`: its last reply
   * or error). Up to MAX_LIMIT_PAUSES times in a row the task waits in progress, like a
   * checkpoint, until just after the reset: "paused". Past that it goes to the user: "over".
   * Null when `text` is no limit notice. `noticeAt`: when the agent wrote it (its `updatedAt`),
   * so a notice read hours late keeps the reset of its own day. Inside `serial`.
   */
  private async usageLimitReached(
    taskId: string,
    record: Orchestration,
    task: Task,
    text: string | null,
    noticeAt: number,
  ): Promise<"paused" | "over" | null> {
    const resumeAt = usageLimitResumeAt(text, this.now(), noticeAt);
    if (!resumeAt || !text) {
      if (record.limitPauses)
        await this.setOrchestration(taskId, { limitPauses: 0 });
      return null;
    }
    // Records created in this session lack the parsed defaults.
    const pauses = (record.limitPauses ?? 0) + 1;
    const assistant = this.assistantOn();
    const attempt = assistant
      ? await this.closeAttempt(taskId, "usage-limit", record)
      : null;
    if (pauses > MAX_LIMIT_PAUSES) {
      await this.setOrchestration(taskId, { summary: text, limitPauses: 0 });
      await this.log(
        record.orchestratorId,
        "warn",
        `"${task.title}": hit the usage limit again after ${MAX_LIMIT_PAUSES} automatic resumes; it needs you`,
        taskId,
        record.agentId,
      );
      if (assistant) {
        const policy = this.policy(this.projectIdOf(task));
        await this.createDelivery(taskId, {
          action: policy.action,
          observe: policy.observe,
          attempt: attempt!,
        });
        await this.settle(
          taskId,
          "usage-limit",
          `${text} (after ${MAX_LIMIT_PAUSES} automatic resumes)`,
        );
      }
      return "over";
    }
    await this.setOrchestration(taskId, {
      status: "waiting",
      finishedAt: this.stamp(),
      checkpoint: true,
      limited: true,
      limitPauses: pauses,
      resumeAt,
      waitingFor: null,
      feedback: null,
      error: null,
    });
    if (assistant)
      await this.record(
        taskId,
        "usage-limit",
        `Paused by the usage limit until ${resumeAt}`,
        { attempt, detail: text },
      );
    await this.log(
      record.orchestratorId,
      "info",
      `"${task.title}": paused by the usage limit (${pauses}/${MAX_LIMIT_PAUSES}); resumes at ${resumeAt}`,
      taskId,
      record.agentId,
    );
    return "paused";
  }
  private async settle(
    taskId: string,
    reason: NeedsYouReason,
    detail: string | null,
  ): Promise<false> {
    await this.markNeedsYou(taskId, reason, detail);
    return false;
  }
  /** An agent that errored or vanished: close its attempt and tell the user. Inside `serial`. */
  private async assistantFailed(
    taskId: string,
    record: Orchestration,
    detail: string,
  ): Promise<void> {
    const task = this.task(taskId);
    const attempt = await this.closeAttempt(taskId, "agent-error", record);
    const policy = this.policy(this.projectIdOf(task));
    await this.createDelivery(taskId, {
      action: policy.action,
      observe: policy.observe,
      attempt,
    });
    await this.record(taskId, "failed", detail, { attempt });
    await this.markNeedsYou(taskId, "agent-error", detail);
  }
  /** Whether an agent in error is still being waited on or nudged. Inside `serial`. */
  private async retryAgent(
    taskId: string,
    record: Orchestration,
    task: Task,
  ): Promise<boolean> {
    const delays =
      this.assistantOptions.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const attempt = await this.ensureAttempt(taskId, record);
    if (attempt.retries >= delays.length) {
      this.retryAt.delete(taskId);
      return false;
    }
    const due = this.retryAt.get(taskId);
    if (due === undefined) {
      this.retryAt.set(taskId, this.now() + delays[attempt.retries]);
      return true;
    }
    if (this.now() < due) return true;
    this.retryAt.delete(taskId);
    const retries = attempt.retries + 1;
    await this.store.update((data) => {
      const last = data.assistant.attempts[taskId]?.at(-1);
      if (last) last.retries = retries;
    });
    let note = `asked it to continue (${retries}/${delays.length})`;
    try {
      await this.host.sendAgent(
        record.agentId!,
        "Continue the task where you stopped.",
      );
    } catch (error) {
      note = `could not ask it to continue: ${message(error)}`;
    }
    await this.setOrchestration(taskId, {
      startedAt: this.stamp(),
      sawRunning: false,
      idleSince: null,
    });
    await this.log(
      record.orchestratorId,
      "warn",
      `"${task.title}": the agent stopped with an error; ${note}`,
      taskId,
      record.agentId,
    );
    return true;
  }
  /** The user accepted the task on the board: close its delivery. Inside `serial`. */
  private async closeDelivery(
    taskId: string,
    by: Exclude<HistoryActor, "orchestrator">, // CUSTOM(assistant-cards)
  ): Promise<void> {
    if (!this.assistantOn()) return;
    const delivery = this.store.current.assistant.deliveries[taskId];
    if (delivery?.stage === "delivered") return;
    if (!delivery && !this.store.current.assistant.attempts[taskId]) return;
    if (delivery)
      await this.patchDelivery(taskId, {
        stage: "delivered",
        reason: null,
        detail: null,
      });
    await this.record(taskId, "done", "Marked done", { by });
  }
  // CUSTOM(factory): the pipeline engine (docs/factory.md, ticket 11) -------------------------
  /** The pipeline a task of this project starts: active mode with the PM on; else null. */
  private projectPipeline(projectId: string | null) {
    return this.assistantOn() ? this.factoryPipeline(projectId) : null;
  }
  /** The pipeline the factory gives this project in active mode, PM on or off; else null. */
  private factoryPipeline(projectId: string | null) {
    if (this.factoryMode() !== "active") return null;
    const applied = this.factoryApplied();
    if (!applied) return null;
    const pipeline = pipelineForProject(
      applied.compiled,
      applied.defaultPipeline,
      projectId,
    );
    return pipeline ? { applied, pipeline } : null;
  }
  /** The task's pipeline state and its pipeline, while active mode still has that pipeline. */
  private taskPipeline(task: Pick<Task, "pipeline">) {
    const state = task.pipeline;
    if (!state || this.factoryMode() !== "active" || !this.assistantOn())
      return null;
    const applied = this.factoryApplied();
    const pipeline = applied?.compiled.pipelines.find((p) => p.id === state.id);
    return applied && pipeline ? { applied, pipeline, state } : null;
  }
  private setTaskPipeline(
    taskId: string,
    state: TaskPipeline | null,
  ): Promise<void> {
    return this.store.update((data) => {
      const task = data.tasks.find((t) => t.id === taskId);
      if (task) task.pipeline = state;
    });
  }
  /**
   * The live orchestrator that runs a stage for a project: the pinned worker, the project's worker
   * with the stage's role, else its implement worker (`fallback`). Null for a `pm` stage or when
   * none exists.
   */
  private stageOrchestrator(
    applied: AppliedFactory,
    stage: CompiledStage,
    projectId: string | null,
    data: Data,
  ): { id: string; fallback: boolean } | null {
    const workers = projectWorkers(
      projectId ?? "",
      applied.compiled.workers.map((worker) => ({
        id: worker.id,
        project: worker.config.projectId,
        role: worker.role,
      })),
    );
    const runner = stageRunner(
      { role: stage.role, ...(stage.worker ? { worker: stage.worker } : {}) },
      workers,
    );
    if (runner?.kind !== "worker") return null;
    const id = new FactoryIds(data.factoryIds, applied.fileIds).liveWorker(
      runner.workerId,
    );
    return data.orchestrators.some((o) => o.id === id)
      ? { id, fallback: runner.fallback }
      : null;
  }
  /**
   * Who takes the task's next run when its pipeline decides it: the worker of a stage a transition
   * entered or of a running stage whose role is not implement (or that pins a worker), and for a
   * task leaving Ready, the worker of a `start` like that. Null keeps today's rule, so an
   * implement stage goes where every task goes today. The orchestrator the user chose for the
   * task takes every stage the project's implement worker would run: an implement stage, and a
   * stage whose role has no worker of its own (the fallback).
   */
  private stageOwner(
    task: Pick<Task, "projectId"> &
      Partial<Pick<Task, "id" | "orchestratorId" | "pipeline" | "workspaceId">>,
    data: Data,
  ): string | null {
    let found: { applied: AppliedFactory; stage: CompiledStage };
    // A task with a workspace runs its current stage; one without starts over at `start`.
    if (task.workspaceId) {
      const live = this.taskPipeline({ pipeline: task.pipeline ?? null });
      const stage = live && findStage(live.pipeline, live.state.stage);
      if (!live || !stage || stage.role === "pm") return null;
      // An implement stage keeps today's owner, unless another role's worker ran last (a rework
      // sent back from `deliver` after a review stage).
      if (!live.state.pending && stage.role === "implement" && !stage.worker) {
        const ran = task.id
          ? data.orchestrations[task.id]?.orchestratorId
          : null;
        const ranRole = ran ? this.factoryWorker(ran)?.worker.role : undefined;
        if (!ranRole || ranRole === "implement") return null;
      }
      found = { applied: live.applied, stage };
    } else {
      const entry = this.projectPipeline(task.projectId);
      const start = entry && findStage(entry.pipeline, entry.pipeline.start);
      if (!entry || !start || (start.role === "implement" && !start.worker))
        return null;
      found = { applied: entry.applied, stage: start };
    }
    const runner = this.stageOrchestrator(
      found.applied,
      found.stage,
      task.projectId,
      data,
    );
    if (!runner) return null;
    const chosen =
      !!task.orchestratorId &&
      data.orchestrators.some((o) => o.id === task.orchestratorId);
    if (
      chosen &&
      !found.stage.worker &&
      (runner.fallback || found.stage.role === "implement")
    )
      return null;
    return runner.id;
  }
  /**
   * The stage's text for its run: its procedure, the spec template for a `spec` stage and the
   * user's gate answer. The run that starts the pipeline from Ready gets none for an implement
   * stage with no `prompt` or `file` of its own: the worker's task prompt is today's procedure.
   */
  private async stagePrompt(
    applied: AppliedFactory,
    pipeline: CompiledPipeline,
    stage: CompiledStage,
    projectId: string | null,
    options: { first?: boolean; note?: string | null } = {},
  ): Promise<string> {
    const own = applied.pipelines[pipeline.id]?.stages[stage.id];
    if (
      options.first &&
      stage.role === "implement" &&
      own?.prompt === undefined &&
      own?.file === undefined
    )
      return "";
    let template: string | null = null;
    if (stage.role === "spec") {
      const project = applied.compiled.projects.find(
        (p) => p.projectId === projectId,
      );
      template = await readFile(
        join(applied.root, project?.specTemplate ?? "templates/spec.md"),
        "utf8",
      ).catch(() => null);
    }
    return stageSection(stage, { template, note: options.note ?? null });
  }
  /** The card's stage chip. */
  private stageChipOf(task: Task): string | null {
    const live = this.taskPipeline(task);
    return live ? stageChip(live.pipeline, live.state) : null;
  }
  /**
   * A stage reported done: follow its `to`, open a Decisões proposal for a gate, or wait in Needs
   * you for the Project Manager to choose among a list of `when` conditions (ticket 12). Null
   * hands the report to today's delivery (a `pm` stage, `deliver`, or a task the engine does not
   * run). Inside `serial`, with the delivery created.
   */
  private async pipelineStageDone(
    taskId: string,
    report: Report,
  ): Promise<boolean | null> {
    const task = this.task(taskId);
    const live = this.taskPipeline(task);
    const stage = live && findStage(live.pipeline, live.state.stage);
    if (!live || !stage || stage.role === "pm") return null;
    const exit = stageExit(stage);
    if (exit.kind === "go")
      return this.pipelineEnter(taskId, exit.to, "to", null);
    if (exit.kind === "choose") {
      // The Project Manager chooses (board_pipeline_advance) or asks (board_pipeline_ask); Needs
      // you wakes it with the report and the candidates.
      await this.setTaskPipeline(taskId, {
        ...live.state,
        gate: { cardId: null, stage: stage.id, kind: "choose" },
      });
      return this.settle(
        taskId,
        "gate",
        `The Project Manager picks the stage after "${stage.id}"`,
      );
    }
    const card = await this.addPmCard({
      kind: "proposal",
      title: `${task.title}: ${exit.question}`.slice(0, 500),
      question: exit.question,
      options: exit.options.map((option) => ({
        id: option.id,
        label: option.label,
        gains: null,
        costs: null,
      })),
      why: `The "${stage.id}" stage of the ${live.pipeline.id} pipeline ends at this gate.`,
      findings: report.summary.slice(0, 20_000),
      links: { taskIds: [taskId], reportIds: [], packageIds: [] },
    });
    await this.setTaskPipeline(taskId, {
      ...live.state,
      gate: { cardId: card.id, stage: stage.id, kind: "gate" },
    });
    return this.settle(taskId, "gate", exit.question);
  }
  /**
   * The open `when` choice of a task that waits on it in Needs you: the stage that ended, its
   * candidates and whether the PM already asked the user. Null otherwise.
   */
  private openChoice(task: Task) {
    const live = this.taskPipeline(task);
    const gate = live?.state.gate;
    const delivery = this.store.current.assistant.deliveries[task.id];
    if (
      !live ||
      gate?.kind !== "choose" ||
      delivery?.stage !== "needs-you" ||
      delivery.reason !== "gate"
    )
      return null;
    const stage = findStage(live.pipeline, gate.stage);
    if (!stage) return null;
    return {
      live,
      stage,
      cardId: gate.cardId,
      candidates: chooseCandidates(stage),
      report: delivery.report,
    };
  }
  /** The wake's extra lines for a task whose `when` choice waits on the PM. */
  private pipelineChoiceLines(task: Task, delivery: Delivery): string[] {
    const choice = this.openChoice(task);
    if (!choice || choice.cardId) return [];
    const clean = (value: string) => value.replace(/\s+/g, " ").trim();
    const summary = clean(delivery.report?.summary ?? "");
    return [
      `  pipeline choice: the "${choice.stage.id}" stage of the ${choice.live.pipeline.id} pipeline ended; settle it with board_pipeline_advance (a candidate whose condition fits the report) or board_pipeline_ask (none fits).`,
      `  candidates: ${choice.candidates.map((c) => `${c.stage} (when: ${clean(c.when)})`).join("; ")}`,
      `  report: ${summary ? (summary.length > 2000 ? `${summary.slice(0, 2000)}...` : summary) : "none"}`,
    ];
  }
  // CUSTOM(factory): autonomy presets (shared/autonomy.ts, ticket 12) ----------------------------
  /** The project's resolved autonomy preset; `standard` outside active mode. */
  projectAutonomy(projectId: string | null): AutonomyPresetId {
    const applied = this.factoryMode() === "active" && this.factoryApplied();
    return applied
      ? autonomyForProject(applied.compiled, projectId)
      : DEFAULT_AUTONOMY;
  }
  /**
   * The id of the project's pipeline. In active mode it is the applied factory's, whether or not
   * the PM is on; otherwise the legacy review map gives `critical` or `default`.
   */
  projectPipelineId(projectId: string | null): string {
    const applied = this.factoryMode() === "active" && this.factoryApplied();
    if (applied)
      return (
        pipelineForProject(applied.compiled, applied.defaultPipeline, projectId)
          ?.id ??
        applied.defaultPipeline ??
        "default"
      );
    // COMPAT(factory-pipelines): added in ticket 13 (2026-11-22), remove after 2027-02-20 once the factory cutover is done
    // Until the cutover the live board has no pipelines; the old review map keeps DreamMMO critical.
    return legacyPipelineFor(this.store.current.assistant.settings, projectId);
  }
  /** A critical project: its pipeline is `critical`. */
  criticalProject(projectId: string | null): boolean {
    return this.projectPipelineId(projectId) === "critical";
  }
  /** Whether merging this project needs the user's ok, by its preset. */
  requiresUserMergeOk(projectId: string | null): boolean {
    return mergeNeedsUser(
      this.projectAutonomy(projectId),
      this.criticalProject(projectId),
    );
  }
  /** The project's rule as the wake and board_overview say it. */
  autonomyRule(projectId: string | null): string {
    return autonomyProjectRule(
      this.projectAutonomy(projectId),
      this.criticalProject(projectId),
    );
  }
  /** Null when `reason` lets a decision on this project go to the user; else the refusal. */
  userOnlyRefusal(
    projectId: string | null,
    reason: UserOnlyReason,
  ): string | null {
    return userOnlyRefusal(
      this.projectAutonomy(projectId),
      this.criticalProject(projectId),
      reason,
    );
  }
  /**
   * board_pipeline_advance: the Project Manager picks the stage after a `when` list. Refused when
   * the task has no open choice, when the PM already asked the user, or when `stage` is not a
   * candidate. Returns the stage the task left and the one it entered.
   */
  async pipelineAdvance(
    taskId: string,
    stage: string,
    reason: string,
  ): Promise<{ from: string; to: string }> {
    return this.serial(async () => {
      const task = this.task(taskId);
      const choice = this.openChoice(task);
      if (!choice)
        throw new Error(
          `Task "${task.title}" has no open pipeline choice: only a stage that ended with a list of when conditions waits for board_pipeline_advance.`,
        );
      if (choice.cardId)
        throw new Error(
          `You already asked the user on card ${choice.cardId}: their answer there moves the task. When they answer in the chat, record it with pm_card_decide (decidedBy user).`,
        );
      if (!choice.candidates.some((candidate) => candidate.stage === stage))
        throw new Error(
          `"${stage}" is not a candidate after "${choice.stage.id}". Candidates: ${choice.candidates.map((c) => `${c.stage} (when: ${c.when})`).join("; ")}. When no condition fits, use board_pipeline_ask.`,
        );
      const from = choice.stage.id;
      const entered = await this.pipelineEnter(
        taskId,
        stage,
        "choose",
        reason.trim() || null,
        "assistant",
      );
      await this.afterPipelineChoice(taskId, entered);
      if (this.task(taskId).pipeline?.pending) {
        this.changed(task.workspaceId ?? undefined);
        await this.orchestrate();
      }
      return { from, to: stage };
    });
  }
  /**
   * board_pipeline_ask: no condition fits, so the Project Manager asks the user on a Decisões
   * proposal whose options are candidate stages. The user's answer moves the task with no PM turn.
   * Refused when the task has no open choice, an option is not a candidate, or the preset leaves
   * the decision to the PM (`reason` other than `no-fit`).
   */
  async pipelineAsk(
    taskId: string,
    input: {
      question: string;
      options: Array<{
        stage: string;
        label?: string | null;
        gains?: string | null;
        costs?: string | null;
      }>;
      recommend?: string | null;
      reason: UserOnlyReason | "no-fit";
      why?: string | null;
    },
  ): Promise<PmCard> {
    return this.serial(async () => {
      const task = this.task(taskId);
      const choice = this.openChoice(task);
      if (!choice)
        throw new Error(
          `Task "${task.title}" has no open pipeline choice to ask about.`,
        );
      if (choice.cardId)
        throw new Error(
          `The user was already asked on card ${choice.cardId}; update that card instead.`,
        );
      if (input.reason !== "no-fit") {
        const refusal = this.userOnlyRefusal(
          this.projectIdOf(task),
          input.reason,
        );
        if (refusal) throw new Error(refusal);
      }
      const candidates = new Map(
        choice.candidates.map((candidate) => [candidate.stage, candidate]),
      );
      const unknown = input.options.filter((o) => !candidates.has(o.stage));
      if (unknown.length || !input.options.length)
        throw new Error(
          `Each option must be a candidate stage after "${choice.stage.id}": ${[...candidates.keys()].join(", ")}${unknown.length ? ` (not candidates: ${unknown.map((o) => o.stage).join(", ")})` : ""}.`,
        );
      const options = input.options
        .filter(
          (option, index, all) =>
            all.findIndex((other) => other.stage === option.stage) === index,
        )
        .map((option) => ({
          id: option.stage,
          label: (
            option.label?.trim() ||
            `${option.stage}: ${candidates.get(option.stage)!.when}`
          ).slice(0, 500),
          gains: option.gains ?? null,
          costs: option.costs ?? null,
        }));
      const card = await this.addPmCard({
        kind: "proposal",
        title: `${task.title}: ${input.question}`.slice(0, 500),
        question: input.question,
        options,
        recommend: input.recommend ?? null,
        userOnlyReason: input.reason === "no-fit" ? null : input.reason,
        why:
          input.why?.trim() ||
          `The "${choice.stage.id}" stage of the ${choice.live.pipeline.id} pipeline lists conditions and none fits its report.`,
        findings: (choice.report?.summary ?? "").slice(0, 20_000),
        links: { taskIds: [taskId], reportIds: [], packageIds: [] },
      });
      await this.setTaskPipeline(taskId, {
        ...choice.live.state,
        gate: { cardId: card.id, stage: choice.stage.id, kind: "choose" },
      });
      await this.record(
        taskId,
        "needs-you",
        `Pipeline: the Project Manager asked the user which stage follows "${choice.stage.id}"`,
        { detail: input.question, by: "assistant" },
      );
      return card;
    });
  }
  /**
   * After the task entered a chosen stage: a `pm` stage or `deliver` (null) hands the report to
   * today's delivery; a worker stage runs on the next pass. Inside `serial`.
   */
  private async afterPipelineChoice(
    taskId: string,
    result: boolean | null,
  ): Promise<void> {
    if (result !== null) return;
    await this.patchDelivery(taskId, {
      stage: "reported",
      reason: null,
      detail: null,
    });
    const policy = this.policy(this.projectIdOf(this.task(taskId)));
    if (await this.deliverDone(taskId, policy.action, policy.observe))
      this.launch(taskId);
  }
  /**
   * Moves the task into `to` and does what that needs. A worker stage queues the task (it stays
   * in progress and the next pass runs the stage); `end` and `cancel` close it. Null: a `pm`
   * stage or `deliver`, which today's delivery runs. Inside `serial`, with a delivery to settle.
   */
  private async pipelineEnter(
    taskId: string,
    to: string,
    via: "to" | "gate" | "choose",
    detail: string | null,
    by?: Exclude<HistoryActor, "orchestrator">, // CUSTOM(factory): ticket 12, the PM's advance
  ): Promise<boolean | null> {
    const live = this.taskPipeline(this.task(taskId));
    if (!live) return null;
    const from = live.state.stage;
    const entered = enterStage(
      live.pipeline,
      live.state,
      to,
      via,
      this.stamp(),
      detail,
    );
    await this.setTaskPipeline(taskId, entered.state);
    if (entered.loop) {
      const text = `Stage "${entered.loop.stage}" would start visit ${entered.loop.visits}; its limit is ${entered.loop.maxVisits}`;
      await this.record(taskId, "stage-entered", `Pipeline loop: ${text}`, {
        detail,
        by,
      });
      return this.settle(taskId, "loop", text);
    }
    await this.record(taskId, "stage-entered", `Pipeline: ${from} → ${to}`, {
      detail,
      by,
    });
    const target = entered.target;
    if (target.kind === "worker") {
      await this.store.update((data) => {
        delete data.assistant.deliveries[taskId];
      });
      await this.setOrchestration(taskId, {
        status: "queued",
        feedback: null,
        ask: null,
        error: null,
        checkpoint: false,
        resumeAt: null,
        waitingFor: null,
      });
      // Resumes are taken from In progress only: a task that waited in Review (a gate, or a
      // report that arrived late) goes back there.
      const task = this.task(taskId);
      const groups = this.store.current.settings.groups;
      const inProgress = orderedGroups(this.store.current.settings).find(
        (g) => g.kind === "in-progress",
      );
      if (
        inProgress &&
        task.workspaceId &&
        groupKind(this.currentStage(task), groups) !== "in-progress"
      )
        await this.moveBound(taskId, inProgress.id);
      return false;
    }
    if (target.kind === "pm" || target.stage === "deliver") return null;
    const kind = target.stage === "end" ? "done" : "canceled";
    await this.patchDelivery(taskId, {
      stage: target.stage === "end" ? "delivered" : "dismissed",
      reason: null,
      detail: null,
    });
    await this.record(
      taskId,
      target.stage === "end" ? "done" : "dismissed",
      target.stage === "end"
        ? "The pipeline ended with no delivery"
        : "The pipeline canceled the task",
    );
    const group = orderedGroups(this.store.current.settings).find(
      (g) => g.kind === kind,
    );
    if (group)
      await this.moveBound(taskId, group.id).catch((error) =>
        this.setOrchestration(taskId, { error: message(error) }),
      );
    return false;
  }
  /** The gate this Decisões card holds, while its task still waits on it in Needs you. */
  private openGate(cardId: string): { kind: "gate" | "choose" } | null {
    const task = this.gateTask(cardId);
    const gate = task?.pipeline?.gate;
    const delivery = task && this.store.current.assistant.deliveries[task.id];
    return gate && delivery?.stage === "needs-you" && delivery.reason === "gate"
      ? { kind: gate.kind }
      : null;
  }
  /**
   * The task whose open gate is this Decisões card. Only active mode has gates: one left over from
   * it (see `closePipelineGates`) holds nothing.
   */
  private gateTask(cardId: string): Task | null {
    if (this.factoryMode() !== "active") return null;
    return (
      this.store.current.tasks.find(
        (task) => task.pipeline?.gate?.cardId === cardId,
      ) ?? null
    );
  }
  /**
   * Active mode turned off: the engine stops, so nothing would answer an open gate. Each gate
   * closes and its Decisões proposal is archived with `GATE_CLOSED_NOTE`; so does a `when` list's
   * choice, waiting on the PM (no card) or on a board_pipeline_ask card. The task keeps its stage
   * and stays in Needs you, where Continue and Done work as today. Inside a store update.
   */
  private closePipelineGates(data: Data): void {
    for (const task of data.tasks) {
      const gate = task.pipeline?.gate;
      if (!task.pipeline || !gate) continue;
      task.pipeline = { ...task.pipeline, gate: null };
      const card = data.assistant.pmBoard.cards.find(
        (c) => c.id === gate.cardId,
      );
      if (!card || card.status === "decided" || card.status === "archived")
        continue;
      card.status = "archived";
      card.decision = GATE_CLOSED_NOTE;
      card.updatedAt = this.stamp(card.updatedAt);
    }
  }
  /**
   * The user answered a gate (or the stage choice) in Decisões: the task leaves Needs you and
   * enters the option's stage, with no PM turn.
   */
  private async pipelineGateDecided(card: PmCard): Promise<void> {
    if (!this.gateTask(card.id)) return;
    await this.serial(async () => {
      const task = this.gateTask(card.id);
      const live = task && this.taskPipeline(task);
      const gate = live?.state.gate;
      if (!task || !live || !gate || gate.cardId !== card.id) return;
      // The task left Needs you another way (dismissed, merged, moved by hand): the gate closes.
      const delivery = this.store.current.assistant.deliveries[task.id];
      if (delivery?.stage !== "needs-you" || delivery.reason !== "gate") {
        await this.setTaskPipeline(task.id, { ...live.state, gate: null });
        return;
      }
      const stage = findStage(live.pipeline, gate.stage);
      const exit = stage ? stageExit(stage) : null;
      const to =
        exit?.kind === "gate"
          ? exit.options.find((option) => option.id === card.answerOptionId)?.to
          : exit?.kind === "choose"
            ? exit.candidates.find(
                (candidate) => candidate.stage === card.answerOptionId,
              )?.stage
            : undefined;
      if (!to) return;
      const label =
        card.options.find((option) => option.id === card.answerOptionId)
          ?.label ?? to;
      const detail =
        card.answer && card.answer !== label
          ? `${label}: ${card.answer}`
          : label;
      const result = await this.pipelineEnter(task.id, to, gate.kind, detail);
      if (result === null) {
        // A `pm` stage or `deliver`: today's delivery takes the stage's report.
        await this.afterPipelineChoice(task.id, result);
        return;
      }
      if (this.task(task.id).pipeline?.pending) {
        this.changed(task.workspaceId ?? undefined);
        await this.orchestrate();
      }
    });
  }
  /**
   * The reviewer answered the task on the board instead of in Decisões: its gate closes. Sent
   * back from a `pm` stage (today's review) or `deliver`, the task returns to its last implement
   * stage (`reworkStage`), so a correction never lands on a reviewer or verifier.
   * Inside `serial`.
   */
  private async pipelineReviewed(
    taskId: string,
    outcome: "done" | "continue",
    by: Exclude<HistoryActor, "orchestrator">,
  ): Promise<void> {
    const task = this.task(taskId);
    const live = this.taskPipeline(task);
    if (!live) return;
    let state = live.state;
    if (state.gate) {
      const cardId = state.gate.cardId;
      if (cardId)
        await this.store.update((data) => {
          const card = data.assistant.pmBoard.cards.find(
            (c) => c.id === cardId,
          );
          if (card && card.status !== "decided" && card.status !== "archived") {
            card.status = "archived";
            card.updatedAt = this.stamp(card.updatedAt);
          }
        });
      state = { ...state, gate: null };
    }
    // Continue after a loop gives the stage that looped a new budget of visits.
    const delivery = this.store.current.assistant.deliveries[taskId];
    if (
      outcome === "continue" &&
      delivery?.stage === "needs-you" &&
      delivery.reason === "loop"
    )
      state = loopContinued(state);
    const stage = findStage(live.pipeline, state.stage);
    if (
      outcome === "continue" &&
      (stage?.role === "pm" || state.stage === "deliver")
    ) {
      state = reviewRework(live.pipeline, state, this.stamp());
      await this.record(
        taskId,
        "stage-entered",
        `Pipeline: ${live.state.stage} → ${state.stage}`,
        { by, detail: state.history.at(-1)?.detail ?? null },
      );
    }
    if (state !== live.state) await this.setTaskPipeline(taskId, state);
  }
  /** Runs the delivery's asynchronous steps, one task at a time. Never blocks `orchestrate`. */
  private launch(taskId: string): void {
    if (this.stopped || this.delivering.has(taskId)) return;
    this.delivering.add(taskId);
    const workspaceId = this.store.current.tasks.find(
      (t) => t.id === taskId,
    )?.workspaceId;
    void this.advance(taskId)
      .catch((error) =>
        this.serial(() =>
          this.markNeedsYou(taskId, "merge-error", message(error)),
        ),
      )
      .catch(() => undefined)
      .finally(() => {
        this.delivering.delete(taskId);
        if (workspaceId) this.changed(workspaceId);
      });
  }
  private async advance(taskId: string): Promise<void> {
    const stageNow = () =>
      this.store.current.assistant.deliveries[taskId]?.stage;
    const needsYou = (reason: NeedsYouReason, detail: string | null) =>
      this.serial(() => this.markNeedsYou(taskId, reason, detail));
    const to = (stage: Delivery["stage"]) =>
      this.serial(() => this.patchDelivery(taskId, { stage }));
    for (;;) {
      if (this.stopped) return;
      const delivery = this.store.current.assistant.deliveries[taskId];
      const task = this.store.current.tasks.find((t) => t.id === taskId);
      if (!delivery || !task) return;
      const stage = delivery.stage;
      const workspace = this.inventory.workspaces.find(
        (w) => w.id === task.workspaceId,
      );
      const policy = this.policy(this.projectIdOf(task));
      const inPlace =
        this.store.current.orchestrations[taskId]?.inPlace === true; // CUSTOM(orchestrator-in-place)
      const reason: NeedsYouReason =
        stage === "preparing-pr" ? "pr-error" : "merge-error";
      try {
        if (stage === "reported") {
          if (delivery.action === "merge")
            await to(
              this.needsVerification(task, policy) ? "verifying" : "committing",
            );
          else if (delivery.action === "prepare-pr") await to("preparing-pr");
          else return;
          continue;
        }
        if (!DELIVERY_STEPS.has(stage)) return;
        if (!workspace)
          return await needsYou(
            reason,
            "Workspace is unavailable or archiving",
          );
        const directory = workspace.workspaceDirectory;
        const agentId =
          this.store.current.orchestrations[taskId]?.agentId ??
          this.store.current.assistant.attempts[taskId]?.at(-1)?.agentId ??
          null;
        if (stage === "verifying") {
          const checks: {
            command: string;
            env?: NodeJS.ProcessEnv;
            timeoutMs?: number;
          }[] = [];
          const verify = policy.verifyCommand.trim();
          if (verify) checks.push({ command: verify });
          // CUSTOM(packages): a risky package ticket runs the package gate here, by script.
          const escalated = await this.escalatedGate(task, policy, directory);
          const gate = escalated?.command.trim() ?? "";
          if (gate && gate !== verify) {
            const missing = escalated
              ? missingGateEnv(escalated, process.env)
              : [];
            if (missing.length) {
              const detail = `Missing required environment: ${missing.join(", ")}. The gate fails instead of letting suites skip.`;
              await this.record(taskId, "verify-failed", detail);
              if (delivery.fixesUsed < policy.autoFixes)
                await this.serial(() => this.requestFix(taskId, gate, detail));
              else await needsYou("verify-failed", detail);
              return;
            }
            checks.push({
              command: gate,
              env: escalated?.env,
              timeoutMs: GATE_TIMEOUT_MS,
            });
          }
          if (!checks.length) {
            await to("committing");
            continue;
          }
          let failed = false;
          for (const check of checks) {
            const runner = this.assistantOptions.verify ?? runVerify;
            const options = {
              ...(check.env ? { env: check.env } : {}),
              ...(check.timeoutMs ? { timeoutMs: check.timeoutMs } : {}),
            };
            const result =
              Object.keys(options).length > 0
                ? await runner(check.command, directory, options)
                : await runner(check.command, directory);
            if (stageNow() !== "verifying") return;
            await this.serial(() =>
              this.patchDelivery(taskId, { verifyOutput: result.output }),
            );
            if (result.passed) {
              await this.record(
                taskId,
                "verify-passed",
                `Check passed: ${check.command}`,
              );
              continue;
            }
            await this.record(
              taskId,
              "verify-failed",
              `Check failed: ${check.command}`,
              {
                detail: result.output.slice(-4000),
              },
            );
            if (delivery.fixesUsed < policy.autoFixes)
              await this.serial(() =>
                this.requestFix(taskId, check.command, result.output),
              );
            else
              await needsYou("verify-failed", `Check failed: ${check.command}`);
            failed = true;
            break;
          }
          if (failed) return;
          await to("committing");
          continue;
        }
        if (stage === "committing") {
          // CUSTOM(orchestrator-in-place): the project folder commits only the task's paths.
          if (inPlace) {
            if (!(await this.commitInPlace(taskId, task, directory, stage)))
              return;
          } else if (await this.host.gitDirty(directory)) {
            // CUSTOM(assistant-autonomy): `commit` stages every new file; a symlinked
            // node_modules would land in the base branch.
            const refusal = dependencyRefusal(
              await this.host.gitStatusLines(directory),
            );
            if (refusal) return await needsYou("dependency-files", refusal);
            await this.host.commit(directory);
            await this.serial(() =>
              this.setFinish(taskId, { committedAt: this.stamp() }),
            );
            await this.record(
              taskId,
              "committed",
              "Committed the task's changes",
            );
          }
          if (stageNow() !== "committing") return;
          // CUSTOM(orchestrator-in-place): the folder is already on its branch, so there is
          // nothing to merge. The commit is the delivery.
          if (inPlace) {
            await this.serial(() => this.completeInPlace(taskId));
            await this.record(taskId, "done", "Done");
            return;
          }
          await to("merging");
          continue;
        }
        if (stage === "merging") {
          let failure: string | null = null;
          let mergeHead: string | null = null;
          const projectDirectory =
            this.inventory.projects.find(
              (item) => item.id === this.projectIdOf(task),
            )?.directory ?? directory;
          // CUSTOM(packages): a package with its own branch takes the next merges, so the
          // branch integrates into the base once, when the package closes.
          const pkg = task.packageId
            ? this.store.current.packages.find(
                (item) => item.id === task.packageId,
              )
            : null;
          const branch = pkg?.branch?.trim() || null;
          const baseRef = branch || policy.baseBranch.trim() || undefined;
          const project = this.inventory.projects.find(
            (item) => item.id === this.projectIdOf(task),
          );
          if (branch && project?.isGit) {
            // A branch that had merges and vanished outside the app is not recreated from the
            // base: those commits would be stranded silently.
            const existing = await this.packageGit.refCommit(
              projectDirectory,
              branch,
            );
            if (!existing && pkg && pkg.branchMergeCount > 0)
              failure = `package-branch-missing: the package branch ${branch} no longer exists and ${pkg.branchMergeCount} merge(s) went to it.`;
            else {
              const base =
                policy.baseBranch.trim() ||
                (await this.host.currentBranch(projectDirectory)) ||
                "HEAD";
              await this.packageGit
                .ensureBranch(projectDirectory, branch, base)
                .catch(() => undefined);
            }
          }
          if (failure === null) {
            try {
              if (branch && pkg) {
                // The ticket worktree's stored base is the project's, so the daemon's merge RPC
                // refuses a different target. Merge the ticket's branch into the package branch
                // in a temporary worktree instead, and never touch the user's checkout.
                const source = await this.host.currentBranch(directory);
                if (!source) throw new Error("package-branch-source-missing");
                const worktree = join(
                  defaultGateDirectory(),
                  `${pkg.id}-ticket`,
                );
                await this.mergeLock.run(pkg.projectId, async () => {
                  await this.packageGit.mergeIntoBranch(
                    projectDirectory,
                    worktree,
                    branch,
                    source,
                  );
                  // Read the merge commit inside the lock, as the base path does.
                  mergeHead = await this.packageGit
                    .refCommit(projectDirectory, branch)
                    .catch(() => null);
                });
              } else {
                await this.mergeLock.run(
                  this.projectIdOf(task) ?? directory,
                  async () => {
                    await this.host.mergeToBase(directory, {
                      baseRef,
                      requireCleanTarget: true,
                      strategy: "merge",
                    });
                    // CUSTOM(packages): read the merge commit inside the lock, before another
                    // merge can move the base.
                    mergeHead = await this.host
                      .gitHead(projectDirectory)
                      .catch(() => null);
                  },
                );
              }
            } catch (error) {
              failure = message(error);
            }
          }
          if (failure !== null && !isUpToDate(failure)) {
            const kind = classifyMergeError(failure);
            // CUSTOM(assistant-autonomy): a conflict goes back to the task's agent, twice at most.
            if (
              kind === "merge-conflict" &&
              delivery.conflictFixes < 2 &&
              agentId
            ) {
              await this.serial(() =>
                this.requestConflictFix(
                  taskId,
                  directory,
                  baseRef ?? policy.baseBranch,
                ),
              );
              return;
            }
            // CUSTOM(assistant-autonomy): a dirty base checkout is waited for, 12 times.
            if (kind === "dirty-checkout") {
              if (delivery.dirtyRetries < MAX_DIRTY_RETRIES) {
                await this.waitForCleanCheckout(taskId, delivery.dirtyRetries);
                return;
              }
              return await needsYou(
                kind,
                await this.dirtyCheckoutDetail(task, failure),
              );
            }
            return await needsYou(kind, failure);
          }
          await this.serial(() => this.completeMerge(taskId));
          // CUSTOM(packages): the merge commit is the bisect's pivot; the package counts merges
          // for its every-N trigger, and `mergeTarget` tells the branch it landed in.
          if (mergeHead || branch)
            await this.serial(() =>
              this.setFinish(taskId, {
                ...(mergeHead ? { mergeCommit: mergeHead } : {}),
                mergeTarget: branch,
              }),
            );
          const mergedTask = this.store.current.tasks.find(
            (item) => item.id === taskId,
          );
          if (mergedTask?.packageId) {
            const packageId = mergedTask.packageId;
            await this.serial(() =>
              this.store.update((data) => {
                const pkg = data.packages.find((item) => item.id === packageId);
                if (pkg) {
                  pkg.mergedSinceGate += 1;
                  if (branch) pkg.branchMergeCount += 1;
                }
              }),
            );
          }
          await this.record(
            taskId,
            "merged",
            branch
              ? `Merged into the package branch ${branch}`
              : "Merged into the base branch",
          );
          await this.record(taskId, "done", "Done");
          return;
        }
        // preparing-pr
        if (!agentId)
          throw new Error("No agent of this task can write the description");
        // CUSTOM(orchestrator-in-place): the PR path commits too, the same way.
        if (inPlace) {
          if (!(await this.commitInPlace(taskId, task, directory, stage)))
            return;
        } else if (await this.host.gitDirty(directory)) {
          const refusal = dependencyRefusal(
            await this.host.gitStatusLines(directory),
          );
          if (refusal) return await needsYou("dependency-files", refusal);
          await this.host.commit(directory);
          await this.serial(() =>
            this.setFinish(taskId, { committedAt: this.stamp() }),
          );
          await this.record(
            taskId,
            "committed",
            "Committed the task's changes",
          );
        }
        const reply = await this.host.askAgent(
          agentId,
          pullRequestPrompt(task),
        );
        const text = parseTicket(reply, "pr");
        await this.serial(() =>
          this.setFinish(taskId, {
            prTitle: text.title,
            prBody: text.description,
          }),
        );
        await this.record(
          taskId,
          "pr-prepared",
          "Pull request description ready",
          {
            detail: text.title,
          },
        );
        await needsYou("notify", "PR description ready");
        return;
      } catch (error) {
        await needsYou(reason, message(error));
        return;
      }
    }
  }
  /**
   * CUSTOM(orchestrator-in-place): the delivery commit of a task that ran in the project folder.
   * The folder is the user's checkout, so only paths that were clean when the task started go in
   * (`inPlaceCommitPlan`). Resolves false when the delivery stops here: it waits for another
   * agent in the folder, or needs the user.
   */
  private async commitInPlace(
    taskId: string,
    task: Task,
    directory: string,
    stage: Delivery["stage"],
  ): Promise<boolean> {
    if (!(await this.host.gitDirty(directory))) return true;
    // Another agent still running in the folder would have its work swept into this commit;
    // wait for the next pass instead.
    const occupant = this.runningFolderOccupant(taskId, directory);
    if (occupant) {
      await this.waitForFolder(taskId, directory, occupant, stage);
      return false;
    }
    // Commits in the project folder share the project's lock with merges, so two deliveries
    // never write the same checkout at once.
    const outcome = await this.mergeLock.run(
      this.projectIdOf(task) ?? directory,
      async () => {
        const report =
          this.store.current.assistant.deliveries[taskId]?.report ?? null;
        const plan = inPlaceCommitPlan({
          current: await this.host.gitStatusLines(directory),
          initialDirty:
            this.store.current.orchestrations[taskId]?.initialDirty ?? [],
          filesChanged: report?.filesChanged ?? [],
          directory,
        });
        if (plan.overlap.length) return { plan, refusal: null };
        const refusal = dependencyRefusal(plan.lines);
        if (!refusal && plan.paths.length)
          await this.host.commit(
            directory,
            plan.paths,
            inPlaceCommitMessage(task.title, report?.summary),
          );
        return { plan, refusal };
      },
    );
    const { plan, refusal } = outcome;
    if (plan.overlap.length) {
      const shown = plan.overlap.slice(0, 10).join(", ");
      const more =
        plan.overlap.length > 10 ? ` and ${plan.overlap.length - 10} more` : "";
      await this.serial(() =>
        this.markNeedsYou(
          taskId,
          "dirty-checkout",
          `Not committed: the task changed files that were already uncommitted when it started (${shown}${more}). Their changes can't be told apart from yours. Commit or revert them yourself, then deliver again or mark the task done.`,
        ),
      );
      return false;
    }
    if (refusal) {
      await this.serial(() =>
        this.markNeedsYou(taskId, "dependency-files", refusal),
      );
      return false;
    }
    const leftOut = plan.leftOut.length
      ? `Left out ${plan.leftOut.length} path(s) already uncommitted when the task started`
      : null;
    if (plan.paths.length) {
      await this.serial(() =>
        this.setFinish(taskId, { committedAt: this.stamp() }),
      );
      await this.record(
        taskId,
        "committed",
        "Committed the task's changes",
        leftOut ? { detail: `${leftOut}:\n${plan.leftOut.join("\n")}` } : {},
      );
    } else if (leftOut)
      await this.record(
        taskId,
        "folder-dirty",
        `Nothing new to commit. ${leftOut}`,
        { detail: plan.leftOut.join("\n") },
      );
    return true;
  }
  /** The merge landed: remember it and move the task to Done. Inside `serial`. */
  private async completeMerge(taskId: string): Promise<void> {
    const at = this.stamp();
    await this.store.update((data) => {
      data.finishes[taskId] = finishSchema.parse({
        ...data.finishes[taskId],
        running: null,
        mergedAt: at,
        error: null,
      });
    });
    const done = orderedGroups(this.store.current.settings).find(
      (group) => group.kind === "done",
    );
    if (done) {
      try {
        await this.moveBound(taskId, done.id);
      } catch (error) {
        await this.setFinish(taskId, {
          error: `Merged, but the task could not move to Done: ${message(error)}`,
        });
      }
    }
    await this.patchDelivery(taskId, {
      stage: "delivered",
      reason: null,
      detail: null,
      dirtyRetries: 0,
    });
  }
  /**
   * CUSTOM(orchestrator-in-place): the commit landed on the branch the folder is on, so the
   * delivery is done without a merge. Moves the task to Done like a merge does. Inside `serial`.
   */
  private async completeInPlace(taskId: string): Promise<void> {
    await this.store.update((data) => {
      const current = data.finishes[taskId];
      data.finishes[taskId] = finishSchema.parse({
        ...current,
        running: null,
        error: null,
        // The agent may have committed on its own; either way the delivery is complete.
        committedAt: current?.committedAt ?? this.stamp(),
      });
    });
    const done = orderedGroups(this.store.current.settings).find(
      (group) => group.kind === "done",
    );
    if (done) {
      try {
        await this.moveBound(taskId, done.id);
      } catch (error) {
        await this.setFinish(taskId, {
          error: `Committed, but the task could not move to Done: ${message(error)}`,
        });
      }
    }
    await this.patchDelivery(taskId, {
      stage: "delivered",
      reason: null,
      detail: null,
      dirtyRetries: 0,
    });
  }
  // CUSTOM(assistant-autonomy): retry timers of deliveries waiting for a clean base checkout.
  private dirtyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private clearDirtyTimer(taskId: string): void {
    const timer = this.dirtyTimers.get(taskId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.dirtyTimers.delete(taskId);
  }
  /** Keeps the delivery in `merging` and tries again later. */
  private async waitForCleanCheckout(
    taskId: string,
    retries: number,
  ): Promise<void> {
    await this.serial(() =>
      this.patchDelivery(taskId, {
        stage: "merging",
        dirtyRetries: retries + 1,
        detail: `Waiting for a clean checkout (${retries + 1}/${MAX_DIRTY_RETRIES})`,
      }),
    );
    if (retries === 0)
      await this.record(
        taskId,
        "waiting-clean",
        "The base checkout has uncommitted changes; waiting for it to be clean",
      );
    if (this.stopped) return;
    this.clearDirtyTimer(taskId);
    this.dirtyTimers.set(
      taskId,
      setTimeout(() => {
        this.dirtyTimers.delete(taskId);
        if (
          this.store.current.assistant.deliveries[taskId]?.stage === "merging"
        )
          this.launch(taskId);
      }, this.assistantOptions.dirtyRetryMs ?? 300_000),
    );
  }
  /** The paths that keep the base checkout dirty, or the git error. */
  private async dirtyCheckoutDetail(
    task: Task,
    failure: string,
  ): Promise<string> {
    const project = this.inventory.projects.find(
      (p) => p.id === this.projectIdOf(task),
    );
    if (!project) return failure;
    try {
      const lines = await this.host.gitStatusLines(project.directory);
      if (!lines.length) return failure;
      const shown = lines.slice(0, 20).join("\n");
      return `The base checkout ${project.directory} still has uncommitted changes after ${MAX_DIRTY_RETRIES} tries:\n${shown}${lines.length > 20 ? `\n... and ${lines.length - 20} more` : ""}`;
    } catch {
      return failure;
    }
  }
  /** A merge conflict goes back to the same agent. Inside `serial`. */
  private async requestConflictFix(
    taskId: string,
    directory: string,
    policyBase: string,
  ): Promise<void> {
    const delivery = this.store.current.assistant.deliveries[taskId];
    const record = this.store.current.orchestrations[taskId];
    if (!delivery) return;
    if (!record?.agentId)
      return this.markNeedsYou(
        taskId,
        "merge-conflict",
        "No agent to send the conflict to",
      );
    const base = await worktreeBaseName(directory, policyBase.trim() || null);
    const prompt = conflictPrompt(base, this.testSection(this.task(taskId))); // CUSTOM(packages)
    // CUSTOM(resource-pools): with no free slot the fix waits for a pass that has one.
    const hold = await this.reactivationHold(taskId, record.orchestratorId);
    const wait = hold && holdText(hold);
    if (!wait)
      try {
        await this.host.sendAgent(record.agentId, prompt);
      } catch (error) {
        return this.markNeedsYou(taskId, "merge-conflict", message(error));
      }
    await this.patchDelivery(taskId, {
      stage: "fixing",
      conflictFixes: delivery.conflictFixes + 1,
      reason: null,
      detail: wait,
      queuedFix: hold
        ? { prompt, reason: "merge-conflict", since: this.stamp(), hold }
        : null,
    });
    const attempt = await this.openAttempt(
      taskId,
      "auto-fix",
      record.agentId,
      record.orchestratorId,
      `Merge conflict with ${base || "the base branch"}`,
    );
    if (!wait) await this.fixSent(taskId);
    await this.record(
      taskId,
      "fix-requested",
      wait
        ? `The merge conflict waits for a free slot (${wait})`
        : "Sent the merge conflict back to the agent",
      { attempt, detail: base || null },
    );
  }
  /** A failed check goes back to the same agent. Inside `serial`. */
  private async requestFix(
    taskId: string,
    command: string,
    output: string,
  ): Promise<void> {
    const delivery = this.store.current.assistant.deliveries[taskId];
    const record = this.store.current.orchestrations[taskId];
    if (!delivery) return;
    if (!record?.agentId)
      return this.markNeedsYou(
        taskId,
        "verify-failed",
        "No agent to send the failure to",
      );
    const prompt = fixPrompt(
      command,
      output,
      this.testSection(this.task(taskId)),
    ); // CUSTOM(packages)
    // CUSTOM(resource-pools): with no free slot the fix waits for a pass that has one.
    const hold = await this.reactivationHold(taskId, record.orchestratorId);
    const wait = hold && holdText(hold);
    if (!wait)
      try {
        await this.host.sendAgent(record.agentId, prompt);
      } catch (error) {
        return this.markNeedsYou(taskId, "verify-failed", message(error));
      }
    await this.patchDelivery(taskId, {
      stage: "fixing",
      fixesUsed: delivery.fixesUsed + 1,
      verifyOutput: output,
      detail: wait,
      queuedFix: hold
        ? { prompt, reason: "verify-failed", since: this.stamp(), hold }
        : null,
    });
    const attempt = await this.openAttempt(
      taskId,
      "auto-fix",
      record.agentId,
      record.orchestratorId,
      output.slice(-4000),
    );
    if (!wait) await this.fixSent(taskId);
    await this.record(
      taskId,
      "fix-requested",
      wait
        ? `The failed check waits for a free slot (${wait})`
        : "Sent the failed check back to the agent",
      {
        attempt,
        detail: command,
      },
    );
  }
  /** The fix prompt reached the agent: its task runs again and counts in the slots. */
  private fixSent(taskId: string): Promise<void> {
    return this.setOrchestration(taskId, {
      status: "running",
      startedAt: this.stamp(),
      finishedAt: null,
      sawRunning: false,
      idleSince: null,
      error: null,
    });
  }
  /**
   * CUSTOM(resource-pools): sends the fixes that waited for a slot, oldest delivery first, while
   * their orchestrator and pool have room. A fix the user overtook (another action moved the
   * delivery, or the task runs again) is dropped and its attempt closed. A fix that waited
   * FIX_WAIT_LIMIT_MS goes to Needs you, to wake the Project Manager, and keeps waiting there.
   * Inside `serial`.
   */
  private async sendQueuedFixes(): Promise<void> {
    const queued = Object.entries(this.store.current.assistant.deliveries)
      .filter(([, delivery]) => delivery.queuedFix)
      .sort(([, a], [, b]) => a.startedAt.localeCompare(b.startedAt));
    for (const [taskId, delivery] of queued) {
      if (this.stopped) return;
      const fix = delivery.queuedFix!;
      const record = this.store.current.orchestrations[taskId];
      if (
        !fixWaits(delivery) ||
        !record?.agentId ||
        (record.status !== "finished" && record.status !== "failed")
      ) {
        await this.patchDelivery(taskId, { queuedFix: null });
        await this.closeFixAttempt(taskId, "dropped");
        continue;
      }
      const hold = await this.reactivationHold(taskId, record.orchestratorId);
      if (hold) {
        await this.holdQueuedFix(taskId, delivery, hold);
        continue;
      }
      try {
        await this.host.sendAgent(record.agentId, fix.prompt);
      } catch (error) {
        await this.patchDelivery(taskId, { queuedFix: null });
        await this.closeFixAttempt(taskId, "agent-error");
        await this.markNeedsYou(taskId, fix.reason, message(error));
        continue;
      }
      // From Needs you (it waited too long) the delivery goes back to fixing.
      await this.patchDelivery(taskId, {
        stage: "fixing",
        reason: null,
        queuedFix: null,
        detail: null,
      });
      await this.fixSent(taskId);
      await this.log(
        record.orchestratorId,
        "info",
        `Sent the waiting fix to "${this.task(taskId).title}"`,
        taskId,
        record.agentId,
      );
    }
  }
  /**
   * CUSTOM(resource-pools): a queued fix still held: keep why, and send it to Needs you once it
   * waited FIX_WAIT_LIMIT_MS. On Needs you only the hold changes, so the card keeps its age.
   */
  private async holdQueuedFix(
    taskId: string,
    delivery: Delivery,
    hold: OrchestratorHold,
  ): Promise<void> {
    const fix = delivery.queuedFix!;
    // A fix queued before `since` existed starts its wait now.
    const since = fix.since ?? this.stamp();
    const wait = holdText(hold);
    if (delivery.stage === "needs-you") {
      if (!isDeepStrictEqual(fix.hold, hold))
        await this.store.update((data) => {
          const current = data.assistant.deliveries[taskId];
          if (current?.queuedFix) current.queuedFix.hold = hold;
        });
      return;
    }
    if (this.now() - Date.parse(since) < FIX_WAIT_LIMIT_MS) {
      if (
        wait !== delivery.detail ||
        !fix.since ||
        !isDeepStrictEqual(fix.hold, hold)
      )
        await this.patchDelivery(taskId, {
          detail: wait,
          queuedFix: { ...fix, since, hold },
        });
      return;
    }
    await this.patchDelivery(taskId, { queuedFix: { ...fix, since, hold } });
    const what =
      fix.reason === "verify-failed" ? "failed check" : "merge conflict";
    await this.markNeedsYou(
      taskId,
      "fix-waiting",
      `The fix for the ${what} has waited ${FIX_WAIT_LIMIT_MS / 60_000} minutes for a free slot (${wait}). It still goes to the agent when a slot frees; merge-now, continue or dismiss replaces it.`,
    );
  }
  /** CUSTOM(resource-pools): closes the auto-fix attempt opened for a queued fix that never ran. */
  private async closeFixAttempt(
    taskId: string,
    outcome: AttemptOutcome,
  ): Promise<void> {
    const at = this.stamp();
    await this.store.update((data) => {
      const last = data.assistant.attempts[taskId]?.at(-1);
      if (!last || last.finishedAt || last.trigger !== "auto-fix") return;
      last.finishedAt = at;
      last.outcome = outcome;
    });
  }
  /** Creates or resets the delivery for an action of the user. Inside `serial`. */
  private async actionDelivery(
    taskId: string,
    action: Delivery["action"],
    stage: Delivery["stage"],
  ): Promise<void> {
    const existing = this.store.current.assistant.deliveries[taskId];
    if (existing && this.delivering.has(taskId))
      throw new Error("A delivery step is already running for this task");
    if (existing)
      await this.patchDelivery(taskId, {
        action,
        stage,
        reason: null,
        detail: null,
        dirtyRetries: 0, // CUSTOM(assistant-autonomy)
      });
    else
      await this.createDelivery(taskId, {
        action,
        stage,
        attempt:
          this.store.current.assistant.attempts[taskId]?.at(-1)?.index ?? 1,
      });
  }
  private reviewable(taskId: string): { task: Task; workspace: Workspace } {
    const task = this.task(taskId);
    const card = this.snapshot().cards.find((c) => c.id === taskId);
    const kind = card
      ? groupKind(card.stage, this.store.current.settings.groups)
      : null;
    if (!task.workspaceId || (kind !== "review" && kind !== "done"))
      throw new Error(
        "Only a task in review or done with a workspace can be delivered",
      );
    const workspace = this.inventory.workspaces.find(
      (w) => w.id === task.workspaceId,
    );
    if (!workspace) throw new Error("Workspace is unavailable or archiving");
    if (workspace.projectKind !== "git")
      throw new Error("This task's project is not a git repository");
    return { task, workspace };
  }
  /** CUSTOM(assistant-wake): the board task one of its agents belongs to, when there is one. */
  private taskOfAgent(agentId: string): string | null {
    const data = this.store.current;
    return (
      Object.entries(data.orchestrations).find(
        ([, record]) => record.agentId === agentId,
      )?.[0] ??
      Object.entries(data.assistant.attempts).find(([, list]) =>
        list.some((attempt) => attempt.agentId === agentId),
      )?.[0] ??
      null
    );
  }
  /**
   * What the user can do from the Projects Dashboard and the report cards; the chat's
   * board_task_action passes `by: "assistant"`.
   */
  assistantAction(
    input: AssistantActionInput,
    by: Exclude<HistoryActor, "orchestrator"> = "user", // CUSTOM(assistant-cards)
  ): Promise<void> {
    return this.serial(async () => {
      if (!this.connected)
        throw new Error(this.error ?? "Paseo is disconnected");
      if (input.type === "send") {
        const data = this.store.current;
        const managed =
          Object.values(data.orchestrations).some(
            (o) => o.agentId === input.agentId,
          ) ||
          Object.values(data.assistant.attempts).some((list) =>
            list.some((a) => a.agentId === input.agentId),
          );
        if (!managed)
          throw new Error("This agent is not managed by the Project Manager");
        await this.host.sendAgent(input.agentId, input.text);
        // CUSTOM(assistant-wake): the assistant messaged the task's agent; that counts as
        // handling it for the reminder, as `board_report` does.
        if (by === "assistant") {
          const taskId = this.taskOfAgent(input.agentId);
          if (
            taskId &&
            this.store.current.assistant.deliveries[taskId]?.stage ===
              "needs-you"
          )
            await this.noteAssistantReported(taskId);
        }
        return;
      }
      // CUSTOM(assistant-cards)
      if (input.type === "answer") {
        await this.answer(input, by);
        return;
      }
      const taskId = input.taskId;
      if (input.type === "merge-now") {
        this.reviewable(taskId);
        await this.actionDelivery(taskId, "merge", "committing");
        this.launch(taskId);
      } else if (input.type === "prepare-pr") {
        this.reviewable(taskId);
        await this.actionDelivery(taskId, "prepare-pr", "preparing-pr");
        this.launch(taskId);
      } else if (input.type === "continue") {
        await this.review(taskId, "continue", input.feedback, by);
      } else if (input.type === "mark-done") {
        await this.review(taskId, "done", "", by);
      } else {
        if (!this.store.current.assistant.deliveries[taskId])
          throw new Error("Nothing to dismiss for this task");
        await this.patchDelivery(taskId, { stage: "dismissed" });
        await this.record(
          taskId,
          "dismissed",
          by === "assistant"
            ? "Dismissed by the assistant"
            : "Dismissed by the user",
          { by },
        );
      }
      // CUSTOM(assistant-wake): an action the assistant took on a task still waiting counts as
      // handling it for the 10-minute reminder, as `board_report` does.
      if (
        by === "assistant" &&
        this.store.current.assistant.deliveries[taskId]?.stage === "needs-you"
      )
        await this.noteAssistantReported(taskId);
    });
  }
  /**
   * CUSTOM(assistant-cards): an answer from a report card, as `assistantAction` gets it. The board
   * task the agent works on continues with it, like Continue task; an agent outside the board gets
   * it as a message. Runs inside `serial`.
   */
  private async answer(
    input: Extract<AssistantActionInput, { type: "answer" }>,
    by: Exclude<HistoryActor, "orchestrator">,
  ): Promise<void> {
    const data = this.store.current;
    const owns = ([, list]: [string, Attempt[]]) =>
      list.some((a) => a.agentId === input.agentId);
    const taskId =
      Object.entries(data.orchestrations).find(
        ([, o]) => o.agentId === input.agentId,
      )?.[0] ?? Object.entries(data.assistant.attempts).find(owns)?.[0];
    if (!taskId || !data.tasks.some((t) => t.id === taskId)) {
      await this.host.sendAgent(input.agentId, input.text);
      return;
    }
    const record = data.orchestrations[taskId];
    // An older agent of the task, or a question the task no longer asks: the card is stale.
    if (record?.agentId !== input.agentId)
      throw new Error("This card is from an earlier run of the task");
    // A finished task is not reopened from a card: the user does that on the board.
    const delivery = data.assistant.deliveries[taskId];
    const card = this.snapshot().cards.find((c) => c.id === taskId);
    if (
      (card && groupKind(card.stage, data.settings.groups) === "done") ||
      delivery?.stage === "delivered" ||
      delivery?.stage === "dismissed"
    )
      throw new Error("This task is already closed");
    // `ask` is written on every finish, with the assistant on or off, so it is the current question.
    if (
      input.question !== null &&
      (record.ask?.question ?? delivery?.report?.question ?? null) !==
        input.question
    )
      throw new Error("This question was already answered or replaced");
    if (record.status !== "finished")
      throw new Error("The task's agent is not waiting for an answer");
    if (this.delivering.has(taskId))
      throw new Error("A delivery step is already running for this task");
    await this.review(taskId, "continue", input.text, by);
  }
  /** CUSTOM(factory): Paseo's projects as the last refresh saw them, without cloning the data. */
  inventoryProjects(): ReadonlyArray<{ id: string; directory: string }> {
    return this.inventory.projects;
  }
  assistantSettings(): {
    settings: AssistantSettings;
    projects: Board["projects"];
  } {
    return {
      settings: this.store.current.assistant.settings,
      projects: this.inventory.projects,
    };
  }
  async setAssistantSettings(input: AssistantSettings) {
    const settings = assistantSettingsSchema.parse(input);
    // CUSTOM(factory): in active mode the factory owns the PM chat, delivery and project policies,
    // so they go to its files. A save that leaves active mode writes nothing there: the board reads
    // the JSON again, and the factory's values are not copied into it.
    const leavingActive =
      this.factoryMode() === "active" && settings.factory.mode !== "active";
    let moves: ColumnMove[] = [];
    await this.serial(() =>
      this.store.update(
        (data) => {
          // COMPAT(factory-pipelines): added in ticket 13 (2026-11-22), remove after 2027-02-20 once the factory cutover is done
          // The page no longer sends `reviews`; the stored legacy map stays as it is (the export
          // reads it), and an incoming one is ignored.
          const { reviews: _incoming, ...rest } = settings;
          const legacy = data.assistant.settings.reviews;
          data.assistant.settings = legacy
            ? { ...rest, reviews: legacy }
            : rest;
          // CUSTOM(factory): the JSON's columns come back; tasks in a column only the factory has
          // move to the default one. The engine stops, so open gates close.
          if (leavingActive) {
            moves = moveOffUnknownColumns(
              data,
              this.store.peek((saved) => saved.settings.groups),
            );
            this.closePipelineGates(data);
          }
        },
        settings.factory.mode === "active" ? CONFIG_EDIT : {},
      ),
    );
    for (const move of moves)
      console.warn(
        `Factory active mode off: task "${move.title}" (${move.taskId}) moved from column "${move.from}", which only the factory has, to "${move.to}".`,
      );
    // CUSTOM(factory): the factory follows a new mode before the reply is read, so leaving active
    // answers with the JSON's values and the page never saves the factory's back into the JSON.
    this.assistantOptions.factory?.sync();
    return this.assistantSettings();
  }
  /** The inputs of the read-side views. */
  assistantSource(): ViewSource {
    return {
      data: this.store.current,
      board: this.snapshot(),
      agents: this.inventory.agents,
      now: new Date(),
      // CUSTOM(assistant-wake): the dashboard counts down to this wake.
      notifyAt: this.wakeDueAt ? new Date(this.wakeDueAt).toISOString() : null,
      description: (taskId) => this.store.description(taskId), // CUSTOM(task-description-files)
    };
  }
  /**
   * CUSTOM(packages): the open package whose branch already holds this ticket's merge. While a
   * package is open, that ticket cannot leave it: its commit is on the package branch and only
   * the package's close integrates that branch into the base. A closed package already did.
   */
  private branchLockedPackage(taskId: string): Package | null {
    const data = this.store.current;
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task?.packageId) return null;
    const pkg = data.packages.find((item) => item.id === task.packageId);
    if (!pkg || pkg.status !== "open" || !pkg.branch) return null;
    const target = data.finishes[taskId]?.mergeTarget;
    return target && target === pkg.branch ? pkg : null;
  }

  // CUSTOM(packages): package mutations. A package is a label with a gate, created after the
  // tickets exist; the delivery still merges into the project's base (2b adds the branch).
  private async packageCreate(
    name: string,
    projectId: string,
    taskIds: readonly string[],
    createdBy: "user" | "assistant",
  ): Promise<void> {
    const project = this.inventory.projects.find((p) => p.id === projectId);
    if (!project) throw new Error("package-project-not-found");
    const tasks = this.store.current.tasks.filter((task) =>
      taskIds.includes(task.id),
    );
    if (tasks.length !== new Set(taskIds).size)
      throw new Error("package-tasks-missing");
    for (const task of tasks)
      if (this.projectIdOf(task) !== projectId)
        throw new Error("package-project-mismatch");
    for (const task of tasks)
      if (this.branchLockedPackage(task.id))
        throw new Error("package-branch-ticket-merged");
    const id = `pkg_${randomUUID().slice(0, 8)}`;
    const now = this.stamp();
    await this.store.update((data) => {
      const pkg = packageSchema.parse({
        id,
        name,
        projectId,
        color: nextPackageColor(data.packages),
        createdAt: now,
        createdBy,
      });
      data.packages.push(pkg);
      for (const task of data.tasks)
        if (taskIds.includes(task.id)) {
          task.packageId = id;
          task.testTier = null;
          task.updatedAt = this.stamp(task.updatedAt);
        }
    });
    this.changed();
  }

  private async packageAssign(
    packageId: string,
    taskIds: readonly string[],
  ): Promise<void> {
    const pkg = this.store.current.packages.find((p) => p.id === packageId);
    if (!pkg) throw new Error("package-not-found");
    if (pkg.status !== "open") throw new Error("package-closed");
    const tasks = this.store.current.tasks.filter((task) =>
      taskIds.includes(task.id),
    );
    if (tasks.length !== new Set(taskIds).size)
      throw new Error("package-tasks-missing");
    for (const task of tasks)
      if (this.projectIdOf(task) !== pkg.projectId)
        throw new Error("package-project-mismatch");
    for (const task of tasks)
      if (task.packageId !== packageId && this.branchLockedPackage(task.id))
        throw new Error("package-branch-ticket-merged");
    await this.store.update((data) => {
      for (const task of data.tasks)
        if (taskIds.includes(task.id)) {
          task.packageId = packageId;
          task.testTier = null;
          task.updatedAt = this.stamp(task.updatedAt);
        }
    });
    this.changed();
  }

  private async packageRemove(taskIds: readonly string[]): Promise<void> {
    for (const taskId of taskIds)
      if (this.branchLockedPackage(taskId))
        throw new Error("package-branch-ticket-merged");
    await this.store.update((data) => {
      for (const task of data.tasks)
        if (taskIds.includes(task.id)) {
          task.packageId = null;
          task.testTier = null;
          task.updatedAt = this.stamp(task.updatedAt);
        }
    });
    this.changed();
  }

  private async packageDelete(packageId: string): Promise<void> {
    if (this.store.current.tasks.some((task) => task.packageId === packageId))
      throw new Error("package-not-empty");
    const pkg = this.store.current.packages.find(
      (item) => item.id === packageId,
    );
    if (pkg) {
      const project = this.inventory.projects.find(
        (item) => item.id === pkg.projectId,
      );
      if (project?.isGit)
        await removeGateWorktree(project.directory, packageId);
    }
    await this.store.update((data) => {
      data.packages = data.packages.filter((pkg) => pkg.id !== packageId);
      data.packageRuns = data.packageRuns.filter(
        (run) => run.packageId !== packageId,
      );
    });
    this.changed();
  }

  private async packageUpdate(
    packageId: string,
    input: Extract<Mutation, { action: "package-update" }>,
  ): Promise<void> {
    const pkg = this.store.current.packages.find((p) => p.id === packageId);
    if (!pkg) throw new Error("package-not-found");
    if (input.branch !== undefined)
      await this.setPackageBranch(pkg, input.branch);
    await this.store.update((data) => {
      const current = data.packages.find((item) => item.id === packageId);
      if (!current) return;
      if (input.name !== undefined) current.name = input.name;
      if (input.color !== undefined) current.color = input.color;
      if (input.gate !== undefined) current.gate = input.gate;
      if (input.trigger !== undefined) current.trigger = input.trigger;
      if (input.tierPolicy !== undefined) current.tierPolicy = input.tierPolicy;
      if (input.status === "open") {
        current.status = "open";
        current.closedAt = null;
      }
    });
    // CUSTOM(packages): closing through an update integrates the branch first, like the
    // package's own Close action.
    if (
      input.status === "closed" &&
      this.store.current.packages.find((item) => item.id === packageId)
        ?.status === "open"
    )
      await this.packageClose(packageId, false);
    this.changed();
  }

  /**
   * CUSTOM(packages): sets or clears a package's integration branch. Already merged tickets stay
   * in the base; only the next merges go to the new branch. A branch with merges cannot be
   * replaced or cleared, so its work is never stranded.
   */
  private async setPackageBranch(
    pkg: Package,
    value: string | null,
  ): Promise<void> {
    const next = value?.trim() || null;
    if (next === pkg.branch) return;
    if (pkg.status !== "open") throw new Error("package-closed");
    const project = this.inventory.projects.find(
      (item) => item.id === pkg.projectId,
    );
    if (!project?.isGit) throw new Error("package-branch-needs-git");
    // The count lives on the package, so moving a ticket out cannot unlock the branch.
    if (pkg.branchMergeCount > 0) throw new Error("package-branch-has-merges");
    if (next && !(await this.packageGit.validBranch(project.directory, next)))
      throw new Error("package-branch-invalid");
    if (next) {
      const policy = this.policy(pkg.projectId);
      const base =
        policy.baseBranch.trim() ||
        (await this.host.currentBranch(project.directory)) ||
        "HEAD";
      await this.packageGit.ensureBranch(project.directory, next, base);
    }
    await this.store.update((data) => {
      const current = data.packages.find((item) => item.id === pkg.id);
      if (current) current.branch = next;
    });
    this.changed();
  }

  /** CUSTOM(packages): merges the package branch into the project's base once, on close. */
  private async integratePackageBranch(pkg: Package): Promise<void> {
    const branch = pkg.branch?.trim();
    if (!branch) return;
    const project = this.inventory.projects.find(
      (item) => item.id === pkg.projectId,
    );
    if (!project?.isGit) return;
    const policy = this.policy(pkg.projectId);
    const base =
      policy.baseBranch.trim() ||
      (await this.host.currentBranch(project.directory)) ||
      "";
    if (!base || base === branch) return;
    const existing = await this.packageGit.refCommit(project.directory, branch);
    if (!existing) {
      if (pkg.branchMergeCount > 0) throw new Error("package-branch-missing");
      return;
    }
    const worktree = join(defaultGateDirectory(), `${pkg.id}-merge`);
    try {
      // The whole worktree lifetime stays under the lock, so a ticket merge and this
      // integration never check out the package branch in two worktrees at once.
      await this.mergeLock.run(pkg.projectId, async () => {
        await this.packageGit.addWorktree(project.directory, worktree, branch);
        try {
          await this.host.mergeToBase(worktree, {
            baseRef: base,
            requireCleanTarget: true,
            strategy: "merge",
          });
        } finally {
          await this.packageGit.removeWorktree(project.directory, worktree);
        }
      });
    } catch (error) {
      throw new Error(`package-branch-merge-failed: ${message(error)}`);
    }
  }

  private async packageClose(
    packageId: string,
    runGate: boolean,
  ): Promise<void> {
    const pkg = this.store.current.packages.find((p) => p.id === packageId);
    if (!pkg) throw new Error("package-not-found");
    if (pkg.status === "open") await this.integratePackageBranch(pkg);
    await this.store.update((data) => {
      const current = data.packages.find((item) => item.id === packageId);
      if (!current) return;
      current.status = "closed";
      current.closedAt = this.stamp();
    });
    if (runGate) await this.startPackageGate(packageId, "close");
    this.changed();
  }

  private async setTestTier(
    taskId: string,
    tier: "restricted" | "gate" | "full",
    reason: string,
    by: "rule" | "pm" | "user",
  ): Promise<void> {
    const task = this.store.current.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("package-task-not-found");
    if (tier !== "full" && !task.packageId)
      throw new Error("package-tier-needs-package");
    if (tier === "full" && task.packageId)
      throw new Error("package-tier-full-package");
    await this.store.update((data) => {
      const current = data.tasks.find((item) => item.id === taskId);
      if (!current) return;
      current.testTier = testTierOverrideSchema.parse({
        tier,
        reason: reason.trim(),
        by,
        at: this.stamp(),
      });
      current.updatedAt = this.stamp(current.updatedAt);
    });
    this.changed();
  }

  /** A package ticket enters verifying even with no verifyCommand: the risk scan and the gate
   * run there. A ticket without a package keeps exactly the old rule. */
  private needsVerification(task: Task, policy: ProjectPolicy): boolean {
    if (policy.verifyCommand.trim()) return true;
    if (!task.packageId) return false;
    const pkg = this.store.current.packages.find(
      (item) => item.id === task.packageId,
    );
    if (!pkg) return false;
    if (effectiveTestTier(task) === "gate") return true;
    return (
      pkg.tierPolicy.escalateOnRisk && policy.tests.gateRiskPaths.length > 0
    );
  }

  /** The test section a ticket's prompts carry; empty outside a package. */
  private testSection(task: Task): string {
    if (!task.packageId) return "";
    const pkg = this.store.current.packages.find(
      (item) => item.id === task.packageId,
    );
    return testSectionFor(
      task,
      this.policy(this.projectIdOf(task)),
      pkg?.name ?? "package",
      pkg ?? null,
    );
  }

  /**
   * The risk rule: a package ticket whose diff touches a project risk path moves to the gate
   * level and the PM board records the decision. Returns the gate to run, if any.
   */
  private async escalatedGate(
    task: Task,
    policy: ProjectPolicy,
    directory: string,
  ): Promise<ReturnType<typeof resolvePackageGate> | null> {
    const pkg = task.packageId
      ? this.store.current.packages.find((item) => item.id === task.packageId)
      : null;
    if (!pkg || !pkg.tierPolicy.escalateOnRisk) return null;
    const gate = resolvePackageGate(pkg, policy);
    if (effectiveTestTier(task) === "gate") return gate;
    let paths: string[] = [];
    let scanError: string | null = null;
    try {
      const scan = this.assistantOptions.changedPaths ?? changedPaths;
      paths = await scan(directory, policy.baseBranch.trim() || null);
    } catch (error) {
      scanError = error instanceof Error ? error.message : String(error);
    }
    // A failed scan must not silently leave the ticket restricted: escalate for safety and
    // record why, so the PM sees it.
    if (scanError) {
      const reason = `risk scan failed: ${scanError}`;
      await this.setEscalatedTier(task, reason);
      await this.packageEscalationCard(pkg, task, [], reason);
      return gate;
    }
    const risky = riskyPaths(paths, policy.tests.gateRiskPaths);
    if (!risky.length) return null;
    const reason = `diff touched ${risky.join(", ")}`;
    await this.setEscalatedTier(task, reason);
    await this.packageEscalationCard(pkg, task, risky, reason);
    return gate;
  }

  private async setEscalatedTier(task: Task, reason: string): Promise<void> {
    await this.serial(() =>
      this.store.update((data) => {
        const current = data.tasks.find((item) => item.id === task.id);
        if (!current) return;
        current.testTier = testTierOverrideSchema.parse({
          tier: "gate",
          reason,
          by: "rule",
          at: this.stamp(),
        });
        current.updatedAt = this.stamp(current.updatedAt);
      }),
    );
  }

  private async packageEscalationCard(
    pkg: Package,
    task: Task,
    risky: readonly string[],
    reason: string,
  ): Promise<void> {
    if (!this.assistantOn()) return;
    const exists = this.pmCards().some(
      (card) =>
        card.kind === "decision" &&
        card.status !== "archived" &&
        card.links.taskIds.includes(task.id) &&
        card.title.toLowerCase().includes("gate"),
    );
    if (exists) return;
    await this.pmCardCreate({
      kind: "decision",
      title: `#${task.number} escalated to gate`,
      decision: `${reason}. The package gate runs for this ticket.`,
      findings: `Package: ${pkg.name}. ${reason}.${risky.length ? ` Matched: ${risky.join(", ")}.` : ""}`,
      links: { taskIds: [task.id], reportIds: [], packageIds: [pkg.id] },
    });
  }

  private packageGates = new Set<string>();
  private gateAbort = new Map<string, AbortController>();

  /** Starts one gate run in the background; the snapshot shows it as running. */
  private async startPackageGate(
    packageId: string,
    trigger: PackageTrigger,
  ): Promise<PackageRun | null> {
    if (this.packageGates.has(packageId)) return null;
    const pkg = this.store.current.packages.find((p) => p.id === packageId);
    if (!pkg) throw new Error("package-not-found");
    const run = packageRunSchema.parse({
      id: `pkgrun-${randomUUID().slice(0, 8)}`,
      packageId,
      trigger,
      status: "running",
      startedAt: this.stamp(),
    });
    this.packageGates.add(packageId);
    this.gateAbort.set(packageId, new AbortController());
    await this.store.update((data) => {
      data.packageRuns.push(run);
      this.trimPackageRuns(data);
    });
    this.changed();
    void this.executePackageGate(run.id, packageId).catch(() => undefined);
    return run;
  }

  private trimPackageRuns(data: Data): void {
    const counts = new Map<string, number>();
    for (const run of data.packageRuns) {
      const count = (counts.get(run.packageId) ?? 0) + 1;
      counts.set(run.packageId, count);
    }
    data.packageRuns = data.packageRuns.filter((run) => {
      if ((counts.get(run.packageId) ?? 0) <= PACKAGE_RUN_LIMIT) return true;
      counts.set(run.packageId, (counts.get(run.packageId) ?? 0) - 1);
      return false;
    });
  }

  private async executePackageGate(
    runId: string,
    packageId: string,
  ): Promise<void> {
    try {
      const data = this.store.current;
      const pkg = data.packages.find((item) => item.id === packageId);
      if (!pkg) return;
      const project = this.inventory.projects.find(
        (item) => item.id === pkg.projectId,
      );
      if (!project) throw new Error(`No project with id ${pkg.projectId}.`);
      const policy = this.policy(pkg.projectId);
      const lastPassed = [...data.packageRuns]
        .filter((run) => run.packageId === packageId && run.status === "passed")
        .sort((left, right) =>
          right.startedAt.localeCompare(left.startedAt),
        )[0];
      const result = await (
        this.assistantOptions.packageGate ?? runPackageGate
      )({
        pkg,
        project,
        policy,
        tasks: data.tasks,
        finishes: data.finishes,
        trigger:
          data.packageRuns.find((run) => run.id === runId)?.trigger ?? "manual",
        lastPassedCommit: lastPassed?.commit ?? null,
        gateDirectory: defaultGateDirectory(),
        run: this.assistantOptions.verify ?? runVerify,
        signal: this.gateAbort.get(packageId)?.signal,
      });
      await this.serial(() =>
        this.store.update((next) => {
          const index = next.packageRuns.findIndex((run) => run.id === runId);
          if (index >= 0)
            next.packageRuns[index] = packageRunSchema.parse({
              ...result,
              id: runId,
            });
          const current = next.packages.find((item) => item.id === packageId);
          if (current) current.mergedSinceGate = 0;
        }),
      );
      if (
        !this.stopped &&
        (result.status === "failed" ||
          result.status === "missing-deps" ||
          result.status === "error")
      ) {
        const suspect = result.suspectTaskId
          ? this.store.current.tasks.find(
              (task) => task.id === result.suspectTaskId,
            )
          : null;
        const findings = [
          `Run ${result.id}: ${result.status} (${result.trigger}).`,
          result.commit ? `Commit: ${result.commit}` : "",
          suspect ? `Suspect: #${suspect.number} ${suspect.title}` : "",
          "Output (tail):",
          "```",
          result.output.slice(-4000),
          "```",
        ]
          .filter(Boolean)
          .join("\n");
        const existing = this.pmCards().find(
          (card) =>
            card.kind === "investigation" &&
            card.status !== "archived" &&
            card.links.packageIds.includes(pkg.id),
        );
        if (existing)
          await this.pmCardUpdate(existing.id, {
            title: `Package gate failed: ${pkg.name}`,
            findings,
            links: {
              ...existing.links,
              taskIds: suspect ? [suspect.id] : existing.links.taskIds,
              packageIds: [pkg.id],
            },
          });
        else
          await this.pmCardCreate({
            kind: "investigation",
            title: `Package gate failed: ${pkg.name}`,
            findings,
            links: {
              taskIds: suspect ? [suspect.id] : [],
              reportIds: [],
              packageIds: [pkg.id],
            },
          });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.store
        .update((data) => {
          const index = data.packageRuns.findIndex((run) => run.id === runId);
          const current = data.packageRuns[index];
          if (current)
            data.packageRuns[index] = packageRunSchema.parse({
              ...current,
              status: "error",
              finishedAt: this.stamp(),
              output: detail.slice(-PACKAGE_OUTPUT_LIMIT),
            });
        })
        .catch(() => undefined);
    } finally {
      this.packageGates.delete(packageId);
      this.gateAbort.delete(packageId);
      this.changed();
    }
  }

  /** The tick's gate triggers: once per night window, and every N merges (2b). */
  private async runPackageGates(): Promise<void> {
    const data = this.store.current;
    const nightStart = openWindowStart(nightSchedule(data.night), this.now());
    for (const pkg of data.packages) {
      if (pkg.status !== "open" || this.packageGates.has(pkg.id)) continue;
      if (pkg.trigger.night && nightStart !== null) {
        const key = new Date(nightStart).toISOString();
        if (pkg.lastNightWindowStart !== key) {
          await this.store.update((next) => {
            const current = next.packages.find((item) => item.id === pkg.id);
            if (current) current.lastNightWindowStart = key;
          });
          await this.startPackageGate(pkg.id, "night");
          continue;
        }
      }
      if (
        pkg.trigger.everyMerges !== null &&
        pkg.mergedSinceGate >= pkg.trigger.everyMerges
      )
        await this.startPackageGate(pkg.id, "merges");
    }
  }

  // CUSTOM(packages): the gate history of one package, read by its detail page.
  packageRuns(packageId: string): PackageRun[] {
    return this.store.current.packageRuns
      .filter((run) => run.packageId === packageId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  /** The column a task shows in: its workspace's labels, else its last or draft stage. */
  private taskStage(
    task: Task,
    data: Data,
    workspace = this.inventory.workspaces.find(
      (w) => w.id === task.workspaceId,
    ),
  ): Stage {
    return task.workspaceId
      ? workspace
        ? resolveStage(
            workspace.labels,
            data.settings.groups,
            data.settings.defaultStartGroup,
          )
        : task.lastStage
      : task.draftStage;
  }
  /**
   * CUSTOM(pm-chat-task-sync): the state of the tasks a chat reply's `seu` line cites, without
   * the board snapshot (the chat polls this every few seconds).
   */
  replyTaskStates(refs: readonly string[]): ReplyTaskState[] {
    const data = this.store.current;
    return buildReplyTaskStates(refs, {
      tasks: data.tasks,
      deliveries: data.assistant.deliveries,
      orchestrations: data.orchestrations,
      groups: data.settings.groups,
      stageOf: (task) => this.taskStage(task, data),
    });
  }
  // CUSTOM(pm-board): the Project Manager's own cards. They never touch a task, a workspace or an
  // agent; this board only stores them, so a card can never start code work.
  pmCards(): PmCard[] {
    return this.store.current.assistant.pmBoard.cards;
  }
  /** The short number of each board task, by id, for the links under a PM card. */
  pmTaskNumbers(): Record<string, number> {
    return Object.fromEntries(
      this.store.current.tasks.map((task) => [task.id, task.number]),
    );
  }
  /** CUSTOM(packages): the package of each ticket, by task id, for the PM board's filter. */
  pmTaskPackages(): Record<string, string> {
    return Object.fromEntries(
      this.store.current.tasks
        .filter((task) => task.packageId)
        .map((task) => [task.id, task.packageId as string]),
    );
  }
  /** CUSTOM(packages): the packages the PM board's filter offers. */
  pmPackages(): { id: string; name: string; color: string }[] {
    return this.store.current.packages.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      color: pkg.color ?? "gray",
    }));
  }
  /**
   * `source` is "pm" for the Project Manager's pm_card_create tool, whose proposals are checked
   * against the autonomy preset; the board's own cards are not.
   */
  async pmCardCreate(
    input: PmCardCreateInput,
    source: "pm" | "board" = "board",
  ): Promise<PmCard> {
    // CUSTOM(factory): a proposal on a task whose merge is the PM's and whose review approved is
    // the PM's to decide (#165); `userOnlyReason` is the way out.
    if (source === "pm") {
      const refusal = await this.approvedMergeRefusal(input);
      if (refusal) throw new Error(refusal);
    }
    // CUSTOM(factory): a reason the projects' autonomy preset does not give the user is refused.
    const reason = input.userOnlyReason;
    if (reason) {
      const tasks = this.store.current.tasks.filter((task) =>
        input.links?.taskIds.includes(task.id),
      );
      const refusals = (
        tasks.length ? tasks.map((task) => this.projectIdOf(task)) : [null]
      ).map((projectId) => this.userOnlyRefusal(projectId, reason));
      if (refusals.every((refusal) => refusal !== null))
        throw new Error(refusals[0]!);
    }
    return this.serial(() => this.addPmCard(input));
  }
  /**
   * CUSTOM(factory): the #165 refusal for a PM proposal with no `userOnlyReason` and no action,
   * when a linked task's project leaves the merge to the PM (`requiresUserMergeOk`) and that task's
   * review approved; null otherwise.
   */
  private async approvedMergeRefusal(
    input: PmCardCreateInput,
  ): Promise<string | null> {
    if (input.kind !== "proposal" || input.userOnlyReason || input.action)
      return null;
    const ids = new Set(input.links?.taskIds ?? []);
    for (const task of this.store.current.tasks) {
      if (!ids.has(task.id)) continue;
      const projectId = this.projectIdOf(task);
      if (this.requiresUserMergeOk(projectId)) continue;
      if (!(await this.reviewApproved(task))) continue;
      return approvedMergeRefusal(
        this.projectAutonomy(projectId),
        this.criticalProject(projectId),
        task.number > 0 ? `#${task.number}` : `"${task.title}"`,
      );
    }
    return null;
  }
  /**
   * CUSTOM(factory): the PM recorded an approved review of this task: among its board_report
   * entries of kind reviewed, feedback and merged, the newest is `reviewed`. A review task the PM
   * closed as approved counts the same way, since the PM records it as `reviewed` on that task.
   */
  private async reviewApproved(task: Task): Promise<boolean> {
    const reports = this.assistantOptions.reports;
    if (!reports) return false;
    const kinds = new Set(["reviewed", "feedback", "merged"]);
    const entries = await reports.since(
      task.createdAt,
      (entry) => entry.taskId === task.id && kinds.has(entry.kind),
    );
    const newest = entries.reduce<(typeof entries)[number] | null>(
      (best, entry) =>
        !best || Date.parse(entry.at) >= Date.parse(best.at) ? entry : best,
      null,
    );
    return newest?.kind === "reviewed";
  }
  /** CUSTOM(factory): a breaker pass is running. */
  private breakerChecking = false;
  /**
   * CUSTOM(factory): the breaker (#165). A proposal that waited on the user past its preset's
   * `breakerMinutes`, with a recommendation and no `userOnlyReason`, wakes the PM once to decide
   * it. A card with `userOnlyReason` never expires. A busy chat, or one on its usage limit, is
   * tried again on the next tick.
   */
  async checkPmBreaker(): Promise<void> {
    if (this.stopped || this.breakerChecking || !this.assistantOn()) return;
    this.breakerChecking = true;
    try {
      const now = this.now();
      const due = this.pmCards().filter((card) => {
        if (!pmBreakerCandidate(card) || this.gateTask(card.id)) return false;
        const ms = this.breakerMs(card);
        return ms !== null && now - Date.parse(card.createdAt) >= ms;
      });
      if (!due.length) return;
      const agentId = this.store.current.assistant.chatAgentId;
      if (!agentId || this.wakeWait() > 0) return;
      const activity = await this.host.agentActivity(agentId);
      if (activity === null || activity === "running" || activity === "waiting")
        return;
      await this.host.sendAgent(
        agentId,
        breakerWakeText(
          due.map((card) => ({
            id: card.id,
            title: card.title,
            recommend: card.recommend!,
            waited: this.waitFor(card.createdAt),
          })),
        ),
      );
      const at = this.stamp();
      const ids = new Set(due.map((card) => card.id));
      await this.store.update((data) => {
        for (const card of data.assistant.pmBoard.cards)
          if (ids.has(card.id)) card.breakerAt = at;
      });
    } catch (error) {
      console.error("Could not run the PM card breaker:", message(error));
    } finally {
      this.breakerChecking = false;
    }
  }
  /**
   * CUSTOM(factory): the breaker's deadline for a card: the shortest of its linked tasks' presets
   * (the board's own preset when it links none); null when any of them has no breaker.
   */
  private breakerMs(card: PmCard): number | null {
    const ids = new Set(card.links.taskIds);
    const tasks = this.store.current.tasks.filter((task) => ids.has(task.id));
    const projects = tasks.length
      ? tasks.map((task) => this.projectIdOf(task))
      : [null];
    let shortest: number | null = null;
    for (const projectId of projects) {
      const ms = autonomyBreakerMs(this.projectAutonomy(projectId));
      if (ms === null) return null;
      shortest = shortest === null ? ms : Math.min(shortest, ms);
    }
    return shortest;
  }
  /** Creates a PM card; inside `serial` (CUSTOM(factory): pipeline gates add theirs there). */
  private async addPmCard(input: PmCardCreateInput): Promise<PmCard> {
    const card = newPmCard(
      `${PM_CARD_ID_PREFIX}${randomUUID().slice(0, 8)}`,
      this.stamp(),
      input,
    );
    await this.store.update((data) => {
      const cards = trimPmCards([card, ...data.assistant.pmBoard.cards]);
      if (cards.length > PM_CARD_LIMIT)
        console.warn(
          `PM board passed its ${PM_CARD_LIMIT}-card limit (${cards.length} cards): no archived card is left to drop.`,
        );
      data.assistant.pmBoard.cards = cards;
    });
    return card;
  }
  async pmCardUpdate(id: string, input: PmCardUpdateInput): Promise<PmCard> {
    let updated: PmCard | null = null;
    await this.serial(() =>
      this.store.update((data) => {
        const cards = data.assistant.pmBoard.cards;
        const index = cards.findIndex((card) => card.id === id);
        if (index < 0) throw new Error(`No PM card with id ${id}.`);
        const current = cards[index]!;
        const options = input.options ?? current.options;
        const next: PmCard = {
          ...current,
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.question !== undefined ? { question: input.question } : {}),
          options,
          recommend:
            input.recommend !== undefined
              ? normalizePmRecommend(input.recommend, options)
              : normalizePmRecommend(current.recommend, options),
          ...(input.why !== undefined ? { why: input.why } : {}),
          ...(input.findings !== undefined ? { findings: input.findings } : {}),
          ...(input.decision !== undefined ? { decision: input.decision } : {}),
          ...(input.answer !== undefined ? { answer: input.answer } : {}),
          ...(input.answerOptionId !== undefined
            ? { answerOptionId: input.answerOptionId }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.links !== undefined ? { links: input.links } : {}),
          ...(input.breakerAt !== undefined
            ? { breakerAt: input.breakerAt }
            : {}),
          updatedAt: this.stamp(current.updatedAt),
        };
        const becomingDecided =
          next.status === "decided" && current.status !== "decided";
        // CUSTOM(factory): a pipeline gate moves the task to the stage its option names. Only
        // the user answers a gate, and a stage choice the PM asked about (board_pipeline_ask);
        // its card stays until it is answered.
        const gate = this.openGate(id);
        if (becomingDecided && gate) {
          if ((input.decidedBy ?? "pm") !== "user")
            throw new Error(GATE_USER_ONLY_ERROR);
          if (!next.options.some((option) => option.id === next.answerOptionId))
            throw new Error(GATE_OPTION_REQUIRED_ERROR);
        }
        if (gate && next.status === "archived" && current.status !== "archived")
          throw new Error(GATE_ARCHIVE_ERROR);
        // Closing a proposal or a decision without a decision or an answer leaves the user
        // without what they were waiting for.
        if (becomingDecided && pmNeedsAnswerToDecide(current.kind)) {
          const decision = (input.decision ?? current.decision ?? "").trim();
          const answer = (input.answer ?? current.answer ?? "").trim();
          if (!decision && !answer)
            throw new Error(
              `PM card ${id} is a ${current.kind}: record a non-empty decision or answer before marking it decided.`,
            );
        }
        // A decision records who decided and when; reopening or going back to investigating
        // clears both. Archiving keeps the record. A notice starts decided without a decider, and
        // updating it must not turn it into "decided by the Project Manager".
        if (next.status === "decided") {
          if (current.status !== "decided" || current.kind === "decision") {
            if (input.decidedBy !== undefined) next.decidedBy = input.decidedBy;
            next.decidedBy ??= "pm";
            next.decidedAt ??= next.updatedAt;
          }
        } else if (
          next.status === "waiting" ||
          next.status === "investigating"
        ) {
          next.decidedBy = null;
          next.decidedAt = null;
        }
        cards[index] = next;
        updated = next;
      }),
    );
    if (!updated) throw new Error(`No PM card with id ${id}.`);
    const card: PmCard = updated;
    if (card.status === "decided") await this.pipelineGateDecided(card); // CUSTOM(factory)
    return card;
  }
  /** Records a decision on a card: the user's answer, or the PM deciding alone. */
  async pmCardDecide(
    id: string,
    input: {
      optionId?: string | null;
      answer?: string | null;
      decision?: string | null;
      by: PmDecider;
    },
  ): Promise<PmCard> {
    const current = this.pmCards().find((card) => card.id === id);
    if (!current) throw new Error(`No PM card with id ${id}.`);
    const option = pmAnswerOption(current, input.optionId ?? null);
    if (input.optionId && !option)
      throw new Error(
        `Card ${id} has no option "${input.optionId}". Options: ${current.options.map((item) => item.id).join(", ") || "none"}.`,
      );
    const decision = input.decision?.trim() || null;
    const answer = input.answer?.trim() || option?.label || null;
    // A proposal is the user's choice: closing it without an answer records nothing of what was
    // chosen, so the decision text alone is not enough.
    if (current.kind === "proposal" && !answer)
      throw new Error(
        `PM card ${id} is a proposal: pass a non-empty answer or one of its options before deciding it.`,
      );
    if (pmNeedsAnswerToDecide(current.kind) && !decision && !answer)
      throw new Error(
        `PM card ${id} is a ${current.kind}: pass a non-empty decision or answer before deciding it.`,
      );
    return this.pmCardUpdate(id, {
      status: "decided",
      answer,
      answerOptionId: option?.id ?? null,
      decision: decision ?? answer,
      decidedBy: input.by,
    });
  }
  /** Sends a decided card back to "Esperando você" and clears the decision it recorded. */
  async pmCardReopen(id: string): Promise<PmCard> {
    return this.pmCardUpdate(id, {
      status: "waiting",
      answer: null,
      answerOptionId: null,
      decision: null,
      // CUSTOM(factory): the user reopened it to answer it themselves; the breaker stays off.
      breakerAt: this.stamp(),
    });
  }
  async pmCardArchive(id: string): Promise<PmCard> {
    return this.pmCardUpdate(id, { status: "archived" });
  }
  // CUSTOM(workboard-chip-status): the counts the Desk header chip shows.
  deskStatus(): DeskStatus {
    const data = this.store.current;
    return deskStatusOf(this.snapshot(data), data.assistant?.deliveries ?? {});
  }
  // CUSTOM(project-icon-colors): the assistant pages color project names without a board snapshot.
  projectAccents(): {
    projects: { id: string; name: string; accent: ProjectAccent | null }[];
  } {
    return {
      projects: this.inventory.projects.map((project) => ({
        id: project.id,
        name: project.name,
        accent: project.accent ?? null,
      })),
    };
  }
  // CUSTOM(project-icon-colors): the image the app shows for each board project.
  projectIcons(): {
    projects: {
      id: string;
      revision: string;
      icon: ProjectIconData | null;
    }[];
  } {
    const known = new Set(this.inventory.projects.map((project) => project.id));
    return {
      projects: this.host
        .projectIcons()
        .projects.filter((project) => known.has(project.id)),
    };
  }
  // CUSTOM(assistant-quick): what the quick-message inbox needs from the chat agent.
  chatSend(agentId: string, text: string): Promise<void> {
    return this.host.sendAgent(agentId, text);
  }
  chatActivity(agentId: string) {
    return this.host.agentActivity(agentId);
  }
  chatLastReply(agentId: string): Promise<string | null> {
    return this.host.lastReply(agentId);
  }
  /**
   * The Project Manager chat agent: the stored one while it exists and is not archived,
   * otherwise (or with `fresh`) a new one.
   */
  openChat(
    fresh: boolean,
    archivePrevious = false, // CUSTOM(assistant-restart-pill)
  ): Promise<{ agentId: string; created: boolean }> {
    return this.serial(async () => {
      const assistant = this.store.current.assistant;
      const current = assistant.chatAgentId;
      if (!fresh && current && (await this.host.agentAlive(current)))
        return { agentId: current, created: false };
      const agentId = await this.createChat(CHAT_INSTRUCTIONS);
      await this.store.update((data) => {
        data.assistant.chatAgentId = agentId;
        data.assistant.compactRetryAt = null; // CUSTOM(assistant-compact): a new chat starts clean
        // CUSTOM(usage-limit): the replaced chat's wait and unread turn are not the new chat's.
        // Its tasks go back to the queue instead of staying silently told to an abandoned chat.
        data.assistant.wakeAt = null;
        data.assistant.wakeAgentId = null;
        data.assistant.wakeTurn = null;
        // CUSTOM(assistant-wake): a new chat has read nothing, so every waiting task is told
        // again, including the ones a quick message or a user-turn steer had marked told.
        for (const delivery of Object.values(data.assistant.deliveries))
          if (delivery.stage === "needs-you") {
            delivery.toldAt = null;
            delivery.firstToldAt = null;
          }
      });
      this.chatId = agentId; // CUSTOM(assistant-compact)
      this.reloadAfterTurn = false; // CUSTOM(assistant-wake): a deferred reload belonged to the old chat
      // CUSTOM(usage-limit): tasks still untold hear from the new chat now, not at the reset the
      // replaced chat was waiting for.
      this.requeueUntold();
      if (this.wakePending.size) this.armWake();
      // CUSTOM(assistant-restart-pill): the replaced chat is archived only once the new one exists.
      if (fresh && archivePrevious && current && current !== agentId)
        await this.host.archiveAgent(current).catch(() => undefined);
      return { agentId, created: true };
    });
  }
  /**
   * Start a chat agent with the assistant's settings and profile; its id is not stored here.
   * `replaces` names the chat it takes over from (CUSTOM(assistant-compact-follow)).
   */
  private async createChat(prompt: string, replaces?: string): Promise<string> {
    const directory =
      this.assistantOptions.chatDirectory ?? defaultChatDirectory();
    await mkdir(directory, { recursive: true });
    const chat = this.store.current.assistant.settings.chat;
    // CUSTOM(unattended-automation): the ship agent is created through create_agent, so the
    // assistant is told which permission mode its role setting asks for.
    const shipUnattended = true;
    const permissionNote = `Automatic agents: when you create the ship agent with create_agent, pass settings: {"unattended": ${shipUnattended}}. It must not stop for a permission prompt.`;
    const profile = await this.agentProfile(
      this.profileRef(ASSISTANT_PROFILE),
      chat.provider,
      chat.skills,
      chat.memory,
    );
    return this.host.startAgentIn(directory, {
      // CUSTOM(agent-profiles)
      ...profile,
      // CUSTOM(unattended-automation): part of the system prompt, so a restarted chat keeps it.
      systemPrompt: profile.systemPrompt
        ? `${profile.systemPrompt}\n\n${permissionNote}`
        : permissionNote,
      provider: chat.provider,
      modeId: chat.modeId,
      thinkingOptionId: chat.thinkingOptionId,
      title: "Project Manager",
      prompt,
      labels: {
        [CHAT_LABEL]: "true",
        ...(replaces ? { [AGENT_REPLACES_LABEL]: replaces } : {}),
      },
      // CUSTOM(unattended-automation)
      unattended: runsUnattended(chat),
    });
  }
  // CUSTOM(assistant-compact): once a turn leaves the chat at its token limit, the board restarts
  // it with a short summary of the recent conversation, the way "Restart chat" does.
  /** The stored chat agent, kept here so agent stream events don't clone the store. */
  private chatId: string | null = null;
  private compactTimer: ReturnType<typeof setTimeout> | undefined;
  private compacting = false;
  /** The chat's context at the last check; undefined until read. */
  private chatTokens: number | null | undefined;
  private chatChanged(): void {
    if (this.stopped) return;
    clearTimeout(this.compactTimer);
    this.compactTimer = setTimeout(() => {
      this.compactTimer = undefined;
      void this.compactChat();
    }, this.assistantOptions.compactSettleMs ?? COMPACT_SETTLE_MS);
  }
  /** The periodic pass checks again only a chat that may be full, in case no update came. */
  private compactOnRefresh(): void {
    const assistant = this.store.current.assistant;
    this.chatId = assistant.chatAgentId;
    const limit = assistant.settings.chat.compactAtTokens;
    if (
      !this.chatId ||
      limit <= 0 ||
      this.compactTimer ||
      this.compacting ||
      this.compactWaiting()
    )
      return;
    if (this.chatTokens === undefined || (this.chatTokens ?? 0) >= limit)
      this.chatChanged();
  }
  /** Nothing waits to reach the chat: no turn, permission, queued message or board wake. */
  private chatQuiet(
    agentId: string,
    context: NonNullable<Awaited<ReturnType<Host["agentContext"]>>>,
  ): boolean {
    return (
      (context.activity === "idle" || context.activity === "attention") &&
      !context.queued &&
      this.wakePending.size === 0 &&
      this.wakeSending.size === 0 &&
      !this.wakeTimer &&
      !this.wakeChecking &&
      !this.assistantOptions.chatQueued?.(agentId)
    );
  }
  /** A failed compaction waits until `compactRetryAt`. */
  private compactWaiting(): boolean {
    const at = Date.parse(this.store.current.assistant.compactRetryAt ?? "");
    return Number.isFinite(at) && this.now() < at;
  }
  /** The chat is still quiet and got no user message since `before` was read. */
  private async chatStillQuiet(
    agentId: string,
    before: NonNullable<Awaited<ReturnType<Host["agentContext"]>>>,
  ): Promise<boolean> {
    const now = await this.host.agentContext(agentId);
    return (
      !!now &&
      this.chatQuiet(agentId, now) &&
      now.lastUserMessageAt === before.lastUserMessageAt
    );
  }
  private async compactChat(): Promise<void> {
    if (this.stopped || this.compacting || this.compactWaiting()) return;
    const assistant = this.store.current.assistant;
    const agentId = assistant.chatAgentId;
    const limit = assistant.settings.chat.compactAtTokens;
    if (!agentId || limit <= 0) return;
    this.compacting = true;
    let stage = "check";
    try {
      const before = await this.host.agentContext(agentId);
      this.chatTokens = before?.usedTokens ?? null;
      if (!before || !this.chatQuiet(agentId, before)) return;
      // A wake's turn is read before the chat that answered it goes away.
      if (assistant.wakeTurn) {
        await this.checkWakeTurn(true);
        if (this.store.current.assistant.wakeTurn) return;
      }
      if (this.wakeWait() > 0) return;
      const used = before.usedTokens;
      if (used === null) return;
      // A chat this compaction started is measured after its first turn. It is compacted again
      // only once it grew by COMPACT_MIN_GROWTH of the limit; born at the limit, never, since
      // compacting it would only start another chat just as big.
      const compact = assistant.compact;
      if (compact?.agentId === agentId) {
        const born = compact.bornTokens ?? used;
        if (compact.bornTokens === null)
          await this.store.update((data) => {
            if (data.assistant.compact?.agentId === agentId)
              data.assistant.compact.bornTokens = used;
          });
        if (born >= limit || used - born < limit * COMPACT_MIN_GROWTH) return;
      }
      if (used < limit) return;
      stage = "summary";
      let summary: string;
      try {
        summary = await this.host.askAgent(agentId, COMPACT_QUESTION);
      } catch (error) {
        console.error(
          "The assistant chat could not summarize itself; using its last messages:",
          message(error),
        );
        summary = await recentExchange(this.host.timeline(agentId));
        if (!summary.trim())
          throw new Error(`no summary (${message(error)}) and no messages`);
      }
      if (this.stopped) return;
      stage = "new chat";
      const outcome = await this.serial(async () => {
        // Checked right before and right after the new chat starts: a message that reached the
        // old chat meanwhile keeps it, and the round waits for the next idle.
        const current = this.store.current.assistant;
        if (current.chatAgentId !== agentId || current.wakeTurn) return null;
        if (!(await this.chatStillQuiet(agentId, before))) return null;
        // CUSTOM(assistant-compact-follow): the label lets the app move the old chat's open tabs
        // and composer draft to this one once the old chat is archived below.
        const id = await this.createChat(compactPrompt(summary, used), agentId);
        if (!(await this.chatStillQuiet(agentId, before))) {
          // The new chat only answered "ok"; the old one carries on.
          await this.host.archiveAgent(id).catch(() => undefined);
          return null;
        }
        await this.store.update((data) => {
          data.assistant.chatAgentId = id;
          data.assistant.compactRetryAt = null;
          data.assistant.compact = {
            agentId: id,
            fromAgentId: agentId,
            fromTokens: used,
            at: this.stamp(),
            bornTokens: null,
          };
          // CUSTOM(assistant-wake): the new chat only has the summary, so it has read nothing.
          // As in `openChat`, every waiting task is told again and no deferred reload carries over.
          data.assistant.wakeAt = null;
          data.assistant.wakeAgentId = null;
          data.assistant.wakeTurn = null;
          for (const delivery of Object.values(data.assistant.deliveries))
            if (delivery.stage === "needs-you") {
              delivery.toldAt = null;
              delivery.firstToldAt = null;
            }
        });
        this.chatId = id;
        this.chatTokens = undefined;
        this.reloadAfterTurn = false;
        this.requeueUntold();
        if (this.wakePending.size) this.armWake();
        // As "Restart chat" does: the old chat is archived only once the new one exists.
        let archiveError: string | null = null;
        await this.host.archiveAgent(agentId).catch((error: unknown) => {
          archiveError = message(error);
        });
        return { id, archiveError: archiveError as string | null };
      });
      if (!outcome) return;
      await this.recordChat(
        "chat-compacted",
        `Chat compacted: ${used} tokens → new chat`,
        { agentId: outcome.id, detail: summary },
      );
      if (outcome.archiveError)
        await this.compactFailed(agentId, "archive", outcome.archiveError);
    } catch (error) {
      await this.compactFailed(agentId, stage, message(error));
    } finally {
      this.compacting = false;
    }
  }
  /** Records the failure and holds the next compaction COMPACT_RETRY_MS. */
  private async compactFailed(
    agentId: string,
    stage: string,
    error: string,
  ): Promise<void> {
    console.error(`Could not compact the assistant chat (${stage}):`, error);
    const retryAt = new Date(this.now() + COMPACT_RETRY_MS).toISOString();
    await this.store
      .update((data) => {
        data.assistant.compactRetryAt = retryAt;
      })
      .catch(() => undefined);
    await this.recordChat(
      "chat-compact-failed",
      `Chat compaction failed at ${stage}; next try after ${retryAt}`,
      { agentId, detail: error },
    );
  }
  /** A history event about the chat itself, filed under CHAT_HISTORY_TASK_ID. */
  private async recordChat(
    kind: HistoryEventKind,
    text: string,
    extra: { agentId: string | null; detail?: string | null },
  ): Promise<void> {
    try {
      await this.assistantOptions.history?.append({
        kind,
        taskId: CHAT_HISTORY_TASK_ID,
        taskTitle: "Project Manager chat",
        projectId: null,
        projectName: "",
        orchestratorId: null,
        orchestratorName: null,
        agentId: extra.agentId,
        attempt: null,
        action: null,
        text: text.slice(0, 2000),
        detail: extra.detail ? extra.detail.slice(0, 5000) : null,
        by: "orchestrator", // CUSTOM(assistant-cards)
      });
    } catch {
      // The history is a log; the board does not depend on it.
    }
  }
  // End CUSTOM(assistant-compact)
  assistantTimeline(agentId: string) {
    return this.host.timeline(agentId);
  }
  /**
   * The task's workspace for the chat's read-only git views: its directory and the base branch
   * the delivery policy would merge into. Undefined when the task has no workspace or the board
   * no longer sees it.
   */
  assistantTaskCheckout(taskId: string):
    | {
        directory: string;
        policyBase: string | null;
        // CUSTOM(orchestrator-in-place)
        inPlace?: boolean;
        baseHead?: string | null;
        initialDirty?: string[];
      }
    | undefined {
    const task = this.store.current.tasks.find((t) => t.id === taskId);
    const workspace = task?.workspaceId
      ? this.inventory.workspaces.find((w) => w.id === task.workspaceId)
      : undefined;
    if (!task || !workspace) return undefined;
    const record = this.store.current.orchestrations[taskId];
    // CUSTOM(orchestrator-in-place): a folder task has no base branch; its base is the HEAD it
    // started from, and the files that were already dirty are listed apart.
    if (record?.inPlace)
      return {
        directory: workspace.workspaceDirectory,
        policyBase: null,
        inPlace: true,
        baseHead: record.baseHead,
        initialDirty: record.initialDirty,
      };
    return {
      directory: workspace.workspaceDirectory,
      policyBase: this.policy(this.projectIdOf(task)).baseBranch.trim() || null,
    };
  }
  // End CUSTOM(projects-assistant) -------------------------------------------------------------
  /**
   * CUSTOM(restart-resume): the restart script writes the agents it must leave alone (the one
   * that ran the restart, plus `--skip-agent`) next to the restart time. Read it only when it
   * belongs to this daemon start; an old file from another restart is ignored.
   */
  private async loadRestartSkip(): Promise<void> {
    this.restartSkipAgents.clear();
    if (this.restartCutoff <= 0) return;
    const file =
      this.assistantOptions.restartStateFile ?? defaultRestartSkipFile();
    let data: { at?: unknown; agents?: unknown };
    try {
      data = JSON.parse(await readFile(file, "utf8")) as {
        at?: unknown;
        agents?: unknown;
      };
    } catch {
      return; // no file, or unreadable: nothing to skip
    }
    if (typeof data.at !== "string" || !Array.isArray(data.agents)) return;
    const at = Date.parse(data.at);
    if (
      !Number.isFinite(at) ||
      Math.abs(at - this.restartCutoff) > RESTART_SKIP_WINDOW_MS
    )
      return;
    for (const id of data.agents)
      if (typeof id === "string") this.restartSkipAgents.add(id);
  }
  /**
   * CUSTOM(restart-resume): the agent was idle when the current daemon started, so a restart cut
   * its turn. Send one "continue" instead of letting the idle settle close the task as
   * no-report. Returns true when the caller must skip the normal idle handling. Inside `serial`.
   */
  private async resumeAfterRestart(
    taskId: string,
    record: Orchestration,
    agent: Agent,
  ): Promise<boolean> {
    if (this.restartCutoff <= 0) return false;
    if (this.restartSkipAgents.has(record.agentId!)) return false;
    // The script sent first: its message is the resume, so do not send a second one.
    if (
      agent.lastUserMessageAt &&
      Date.parse(agent.lastUserMessageAt) >= this.restartCutoff
    )
      return false;
    if (Date.parse(agent.updatedAt) >= this.restartCutoff) return false;
    // Never seen running: the "still starting" grace in the caller applies, not a resume.
    if (!record.sawRunning) return false;
    // Already in the 20 s settle before the restart: it finishes as it would have.
    if (record.idleSince && Date.parse(record.idleSince) < this.restartCutoff)
      return false;
    const handledAt = record.restartResumeAt
      ? Date.parse(record.restartResumeAt)
      : 0;
    if (handledAt >= this.restartCutoff)
      return this.now() - handledAt < RESTART_RESUME_GRACE_MS;
    const task = this.task(taskId);
    try {
      await this.host.sendAgent(record.agentId!, RESTART_RESUME_MESSAGE);
    } catch (error) {
      await this.log(
        record.orchestratorId,
        "warn",
        `"${task.title}": could not resume after the daemon restart: ${message(error)}`,
        taskId,
        record.agentId,
      );
      return false;
    }
    await this.setOrchestration(taskId, {
      sawRunning: true,
      idleSince: null,
      restartResumeAt: this.stamp(),
    });
    await this.log(
      record.orchestratorId,
      "info",
      `"${task.title}": resumed after the daemon restart`,
      taskId,
      record.agentId,
    );
    return true;
  }
  /**
   * CUSTOM(board-turn-end): the agent ended another turn after the task settled as no-report
   * (typically a background subagent handed back). Re-read its reply once per turn and, when it
   * is now a valid report, deliver as if it had arrived on time. Runs inside `serial`.
   */
  private async recoverLateReport(
    taskId: string,
    record: Orchestration,
  ): Promise<void> {
    const delivery = this.store.current.assistant.deliveries[taskId];
    if (delivery?.stage !== "needs-you" || delivery.reason !== "no-report")
      return;
    const agent = this.inventory.agents.find((a) => a.id === record.agentId);
    if (!agent) return;
    if (
      agent.activity === "running" ||
      agent.activity === "waiting" ||
      agent.activity === "error"
    ) {
      this.lateIdleSince.delete(taskId);
      return;
    }
    const since = this.lateIdleSince.get(taskId);
    if (since === undefined) {
      this.lateIdleSince.set(taskId, this.now());
      this.scheduleSettleCheck();
      return;
    }
    if (this.now() - since < IDLE_SETTLE_MS) {
      this.scheduleSettleCheck();
      return;
    }
    if (
      !record.finishedAt ||
      Date.parse(agent.updatedAt) <= Date.parse(record.finishedAt) ||
      this.lateChecked.get(taskId) === agent.updatedAt
    )
      return;
    this.lateChecked.set(taskId, agent.updatedAt);
    const reply = await this.host.lastReply(record.agentId!);
    const parsed = reply ? parseReport(reply) : null;
    if (!reply || !parsed?.report) return;
    const task = this.task(taskId);
    // Reopen the attempt that ended as no-report so the report closes it with its real outcome.
    await this.store.update((data) => {
      const last = data.assistant.attempts[taskId]?.at(-1);
      if (last?.outcome === "no-report") {
        last.finishedAt = null;
        last.outcome = "running";
      }
    });
    await this.setOrchestration(taskId, { finishedAt: this.stamp() });
    const launch = await this.assistantFinished(
      taskId,
      this.store.current.orchestrations[taskId],
      reply,
    );
    await this.record(taskId, "report", "The report arrived late", {
      attempt: this.store.current.assistant.deliveries[taskId]?.attempt,
      detail: parsed.report.summary.split("\n")[0].slice(0, 200),
    });
    await this.log(
      record.orchestratorId,
      "info",
      `"${task.title}": the report arrived late`,
      taskId,
      record.agentId,
    );
    if (launch) this.launch(taskId);
  }
  private setOrchestration(
    taskId: string,
    change: Partial<Orchestration>,
  ): Promise<void> {
    return this.store.update((data) => {
      const previous = data.orchestrations[taskId];
      data.orchestrations[taskId] = {
        ...(previous ?? {
          status: "starting",
          workspaceId: null,
          agentId: null,
          startedAt: this.stamp(),
          finishedAt: null,
          sawRunning: false,
          idleSince: null,
          error: null,
        }),
        ...change,
      };
    });
  }
  /**
   * Follow the agents the orchestrators started and move finished tasks to review. Then each
   * orchestrator whose window is open, or whose run (Run now or a daily time) still has tasks to
   * start, takes its Ready to start tasks up to its concurrency limit. Runs inside `serial`.
   */
  private async orchestrate(): Promise<void> {
    if (this.stopped || !this.connected) return;
    const groups = this.store.current.settings.groups;
    const review = orderedGroups(this.store.current.settings).find(
      (group) => group.kind === "review",
    );
    for (const [taskId, record] of Object.entries(
      this.store.current.orchestrations,
    )) {
      const task = this.store.current.tasks.find((t) => t.id === taskId);
      if (!task || hidden(task)) {
        await this.store.update((data) => {
          delete data.orchestrations[taskId];
          delete data.assistant.deliveries[taskId]; // CUSTOM(projects-assistant)
          delete data.assistant.progress[taskId]; // CUSTOM(task-checkpoints)
        });
        continue;
      }
      // CUSTOM(board-turn-end): a task settled as no-report may still get its report later.
      if (record.status === "finished" && record.agentId && this.assistantOn())
        await this.recoverLateReport(taskId, record);
      // CUSTOM(task-checkpoints): a waiting task moved out of In progress by hand stops there.
      if (
        record.checkpoint &&
        (record.status === "queued" || record.status === "waiting")
      ) {
        const kind = groupKind(this.currentStage(task), groups);
        if (kind !== "in-progress" && kind !== "ready") {
          await this.setOrchestration(taskId, {
            status: "finished",
            checkpoint: false,
            resumeAt: null,
            waitingFor: null,
            limited: false, // CUSTOM(usage-limit)
            limitPauses: 0,
          });
          await this.log(
            record.orchestratorId,
            "info",
            `"${task.title}" left In progress; its checkpoint will not resume`,
            taskId,
            record.agentId,
          );
        }
        continue;
      }
      if (record.status !== "running" || !record.agentId) continue;
      const agent = this.inventory.agents.find((a) => a.id === record.agentId);
      const elapsed = this.now() - Date.parse(record.startedAt);
      if (!agent) {
        if (elapsed > 120_000) {
          await this.setOrchestration(taskId, {
            status: "failed",
            finishedAt: this.stamp(),
            error: "The agent is gone",
            limitPauses: 0, // CUSTOM(usage-limit)
          });
          await this.log(
            record.orchestratorId,
            "error",
            `"${task.title}": the agent is gone`,
            taskId,
            record.agentId,
          );
          // CUSTOM(projects-assistant)
          if (this.assistantOn())
            await this.assistantFailed(taskId, record, "The agent is gone");
        }
        continue;
      }
      // CUSTOM(unattended-automation): layer C. Whatever layer B could not approve, the
      // board surfaces within PERMISSION_WAIT_MS instead of leaving the task silent. A
      // hidden board subagent of this agent counts as the task waiting.
      if (agent.waitingPermission || this.waitingBoardChild(record.agentId)) {
        const since = record.permissionSince ?? this.stamp();
        if (!record.sawRunning || record.idleSince || !record.permissionSince)
          await this.setOrchestration(taskId, {
            sawRunning: true,
            idleSince: null,
            permissionSince: since,
          });
        if (
          !record.permissionNeedsYou &&
          this.now() - Date.parse(since) >= PERMISSION_WAIT_MS
        )
          await this.permissionNeedsYou(taskId, record, task, since);
        continue;
      }
      if (record.permissionSince || record.permissionNeedsYou)
        await this.clearPermissionWait(taskId);
      if (agent.activity === "running" || agent.activity === "waiting") {
        if (!record.sawRunning || record.idleSince)
          await this.setOrchestration(taskId, {
            sawRunning: true,
            idleSince: null,
          });
        continue;
      }
      if (agent.activity === "error") {
        // CUSTOM(usage-limit): the usage limit waits for its reset instead of "continue" nudges.
        // A resumed agent still shows the old error until it runs; give it the start delay.
        if (usageLimitResumeAt(agent.lastError, this.now())) {
          if (!record.sawRunning && elapsed < 90_000) continue;
          this.retryAt.delete(taskId);
          const limit = await this.usageLimitReached(
            taskId,
            record,
            task,
            agent.lastError!,
            Date.parse(agent.updatedAt),
          );
          if (limit === "over")
            await this.setOrchestration(taskId, {
              status: "failed",
              finishedAt: this.stamp(),
              error: agent.lastError!,
            });
          continue;
        }
        // CUSTOM(projects-assistant): a transient error gets up to three "continue" nudges first.
        if (this.assistantOn() && (await this.retryAgent(taskId, record, task)))
          continue;
        await this.setOrchestration(taskId, {
          status: "failed",
          finishedAt: this.stamp(),
          error: "The agent stopped with an error",
          limitPauses: 0, // CUSTOM(usage-limit)
        });
        await this.log(
          record.orchestratorId,
          "error",
          `"${task.title}": the agent stopped with an error`,
          taskId,
          record.agentId,
        );
        // CUSTOM(projects-assistant)
        if (this.assistantOn())
          await this.assistantFailed(
            taskId,
            record,
            "The agent stopped with an error",
          );
        continue;
      }
      // Idle before it was ever seen running means it may not have started yet.
      if (!record.sawRunning && elapsed < 90_000) continue;
      // CUSTOM(restart-resume): the daemon restarted and cut this turn; send "continue"
      // instead of letting the idle settle close it as no-report. A task already in its
      // settle, or never seen running, is not resumed.
      if (await this.resumeAfterRestart(taskId, record, agent)) continue;
      // CUSTOM(board-turn-end): idle must hold for a while; a subagent may be about to hand back.
      if (!record.idleSince) {
        await this.setOrchestration(taskId, { idleSince: this.stamp() });
        this.scheduleSettleCheck();
        continue;
      }
      if (this.now() - Date.parse(record.idleSince) < IDLE_SETTLE_MS) {
        this.scheduleSettleCheck();
        continue;
      }
      await this.setOrchestration(taskId, {
        status: "finished",
        finishedAt: this.stamp(),
      });
      const workspace = this.inventory.workspaces.find(
        (w) => w.id === task.workspaceId,
      );
      const summary = await this.host.lastReply(record.agentId);
      // CUSTOM(usage-limit): a turn cut by the usage limit waits for the reset, or (past the
      // limit of pauses) already went to the user.
      const limit = await this.usageLimitReached(
        taskId,
        record,
        task,
        summary,
        Date.parse(agent.updatedAt),
      );
      if (limit === "paused") continue;
      // CUSTOM(projects-assistant): with the assistant on, the report decides what happens next.
      let launch = false;
      if (limit === "over") {
        // Settled by usageLimitReached; the card goes to review below.
      } else if (this.assistantOn())
        launch = await this.assistantFinished(taskId, record, summary);
      // CUSTOM(assistant-cards): the report's question too, replacing any older one.
      else
        await this.setOrchestration(taskId, {
          ...(summary ? { summary } : {}),
          ask: askOf(summary ? parseReport(summary).report : null),
        });
      // CUSTOM(task-checkpoints): the task stays in progress and resumes later.
      // CUSTOM(factory): so does a task its pipeline moved to the next worker stage.
      if (
        this.store.current.orchestrations[taskId]?.checkpoint ||
        this.task(taskId).pipeline?.pending
      )
        continue;
      await this.log(
        record.orchestratorId,
        "info",
        `Finished "${task.title}"; ready to review`,
        taskId,
        record.agentId,
      );
      if (
        review &&
        workspace &&
        // CUSTOM(factory): read again; a pipeline's `end` or `cancel` already moved it.
        groupKind(this.task(taskId).lastStage, groups) === "in-progress"
      ) {
        try {
          await this.moveBound(taskId, review.id);
        } catch (error) {
          await this.setOrchestration(taskId, { error: message(error) });
        }
      }
      if (launch) this.launch(taskId); // CUSTOM(projects-assistant)
    }
    await this.promoteScheduled(); // CUSTOM(night-tasks)
    await this.runPackageGates(); // CUSTOM(packages)
    // CUSTOM(resource-pools): one RAM reading per pass; fixes waiting for a slot go before new tasks.
    await this.readPoolMemory();
    await this.sendQueuedFixes();
    const stage = defaultStartWorkGroup(
      groups,
      this.store.current.settings.defaultStartWorkGroup,
    );
    if (stage) await this.startReady(stage);
    await this.nightShutdown(); // CUSTOM(night-tasks)
    this.armDueTimer();
  }
  /**
   * Each orchestrator whose window is open, or whose run still has tasks to start, takes its
   * Ready to start tasks up to its limit. CUSTOM(night-tasks): while the night window is open,
   * every enabled orchestrator also takes its night tasks from Scheduled, whatever its own
   * schedule, without using its run's batch.
   */
  private async startReady(stage: Stage): Promise<void> {
    if (this.factoryHeld()) return; // CUSTOM(factory)
    const board = this.snapshot();
    const nightStart = openWindowStart(
      nightSchedule(this.store.current.night),
      this.now(),
    );
    const candidates = orderedGroups(this.store.current.settings)
      .filter(
        (group) =>
          group.kind === "ready" ||
          (group.kind === "scheduled" && nightStart !== null),
      )
      .flatMap((group) =>
        cardsForStage(board.cards, group.id, board.cardOrderByStage).map(
          (card) => ({
            card,
            night: group.kind === "scheduled",
            resume: false,
          }),
        ),
      )
      .filter(
        ({ card, night }) =>
          (!night || card.timing?.kind === "night") && this.eligible(card),
      );
    // CUSTOM(task-checkpoints): tasks in progress that a checkpoint queued, whatever the schedule.
    const resumes = orderedGroups(this.store.current.settings)
      .filter((group) => group.kind === "in-progress")
      .flatMap((group) =>
        cardsForStage(board.cards, group.id, board.cardOrderByStage).map(
          (card) => ({ card, night: false, resume: true, column: group.id }),
        ),
      )
      .filter(({ card }) => {
        const record = this.store.current.orchestrations[card.id];
        return (
          !card.binding &&
          !card.archived &&
          !!card.workspaceId &&
          // CUSTOM(factory): a pipeline stage waiting for its run resumes the same way.
          (!!record?.checkpoint || !!card.pipeline?.pending) &&
          this.resumable(record)
        );
      });
    // CUSTOM(resource-pools): slots already used in each pool, kept up to date during this pass.
    const pools = this.store.current.settings.pools;
    const poolUsed = new Map(
      pools.map((pool) => [pool.id, this.runningInPool(pool.id)]),
    );
    // CUSTOM(orchestrator-in-place): folders already used by a folder-mode task of any
    // orchestrator; a second one waits for the next pass.
    const inPlaceBusy = this.inPlaceDirectories();
    // First each orchestrator's run and window, then the cards in column order, so a pool's
    // free slot goes to the top card of any of its orchestrators, not to the first in the list.
    const takers: Array<{
      config: OrchestratorConfig;
      open: boolean;
      slots: number;
      pool: Pool | null;
      hold: OrchestratorHold | null;
      limitHeld: boolean; // CUSTOM(usage-limit)
    }> = [];
    for (const config of [...this.store.current.orchestrators]) {
      if (this.stopped) break;
      if (!config.enabled) {
        if (this.runtime(config.id).quota > 0)
          await this.endRun(config.id, "disabled");
        continue;
      }
      const due = dueTrigger(
        config.schedule,
        this.runtime(config.id).lastTriggerAt,
        this.now(),
      );
      if (due !== null) {
        await this.setRuntime(config.id, {
          quota: config.batchSize,
          started: 0,
          runStartedAt: this.stamp(),
          lastTriggerAt: new Date(due).toISOString(),
        });
        await this.log(
          config.id,
          "info",
          `Scheduled run: up to ${config.batchSize} tasks`,
        );
      }
      const open = windowOpen(config.schedule, this.now());
      const quota = this.runtime(config.id).quota;
      // CUSTOM(task-checkpoints): a due resume is taken whatever the run or the window.
      const resumesDue = resumes.some(({ card }) => this.owns(config, card));
      if (quota <= 0 && !open && nightStart === null && !resumesDue) continue;
      if (
        quota > 0 &&
        !candidates.some(({ card, night }) => !night && this.owns(config, card))
      )
        await this.endRun(config.id, "nothing left in Ready to start");
      // CUSTOM(usage-limit): while one of its tasks waits for the usage limit to reset, a new task
      // would only hit it too; resumes still go.
      const limitHeld = Object.values(this.store.current.orchestrations).some(
        (record) =>
          record.orchestratorId === config.id &&
          record.limited &&
          record.status === "waiting",
      );
      if (!limitHeld) this.limitHoldLogged.delete(config.id);
      else if (
        !this.limitHoldLogged.has(config.id) &&
        candidates.some(({ card }) => this.owns(config, card))
      ) {
        this.limitHoldLogged.add(config.id);
        await this.log(
          config.id,
          "info",
          "Ready to start waits: a task is paused by the usage limit",
        );
      }
      takers.push({
        config,
        open,
        // CUSTOM(orchestrator-in-place): folder mode runs one task at a time.
        slots:
          (config.useWorktree ? config.maxConcurrent : 1) -
          this.runningFor(config.id),
        pool: this.poolOf(config),
        hold: null,
        limitHeld,
      });
    }
    let started = false;
    // CUSTOM(task-checkpoints): resumes first; they use no quota and keep their column.
    for (const { card, night, resume, column } of [
      ...resumes,
      ...candidates.map((item) => ({ ...item, column: stage })),
    ]) {
      if (this.stopped) break;
      for (const taker of takers) {
        const { config, pool } = taker;
        if (taker.slots <= 0 || taker.hold || !this.owns(config, card))
          continue;
        if (!resume && taker.limitHeld) continue; // CUSTOM(usage-limit)
        const runtime = this.runtime(config.id);
        if (!night && !resume && !taker.open && runtime.quota <= 0) continue;
        // CUSTOM(resource-pools): the pool must have a free slot and enough free RAM too.
        taker.hold = pool && this.poolHold(pool, poolUsed.get(pool.id) ?? 0);
        if (taker.hold) continue;
        // CUSTOM(orchestrator-in-place): one folder-mode task per project folder, whichever
        // orchestrator owns it.
        const folder = this.inPlaceFolder(config, card);
        const occupant = folder ? inPlaceBusy.get(folder) : undefined;
        if (folder && occupant) {
          await this.logFolderWait(config.id, folder, occupant);
          continue;
        }
        const outcome = await this.startCard(config, card, column, night);
        if (outcome === "skipped") break;
        taker.slots--;
        if (pool) poolUsed.set(pool.id, (poolUsed.get(pool.id) ?? 0) + 1);
        if (folder && outcome === "started") {
          inPlaceBusy.set(folder, card.title);
          this.loggedFolderHolds.delete(config.id);
        }
        started = true;
        if (night) {
          if (outcome === "started")
            await this.nightStarted(nightStart!, card.title);
        } else if (!resume && runtime.quota > 0) {
          await this.setRuntime(config.id, {
            quota: runtime.quota - 1,
            started: runtime.started + 1,
          });
          if (runtime.quota === 1) await this.endRun(config.id, "batch done");
        }
        break;
      }
    }
    for (const taker of takers) await this.logHold(taker.config.id, taker.hold); // CUSTOM(resource-pools)
    if (started) await this.reconcile();
  }
  // CUSTOM(night-tasks) ---------------------------------------------------------------------
  private nightActiveAt = -Infinity;
  private dueTimer: ReturnType<typeof setTimeout> | undefined;
  private get nightSystem(): NightSystem {
    return this.assistantOptions.night ?? defaultNightSystem;
  }
  /** The first Scheduled group, where night tasks and timed tasks wait. */
  private scheduledGroup(data: Data = this.store.current): Stage {
    const group = orderedGroups(data.settings).find(
      (group) => group.kind === "scheduled",
    );
    if (!group) throw new Error("Add a Scheduled group to schedule tasks");
    return group.id;
  }
  private nightLog(data: Data, text: string): void {
    data.nightRuntime.log = [
      ...data.nightRuntime.log,
      { at: this.stamp(), text },
    ].slice(-NIGHT_LOG_LIMIT);
  }
  /** A task whose start time came moves to the first Ready to start group. */
  private async promoteScheduled(): Promise<void> {
    const groups = this.store.current.settings.groups;
    const ready = orderedGroups(this.store.current.settings).find(
      (group) => group.kind === "ready",
    );
    if (!ready) return;
    const due = (task: Task) =>
      !task.workspaceId &&
      !task.binding &&
      !hidden(task) &&
      task.timing?.kind === "at" &&
      Date.parse(task.timing.at) <= this.now() &&
      groupKind(task.draftStage, groups) === "scheduled";
    if (!this.store.current.tasks.some(due)) return;
    await this.store.update((data) => {
      for (const task of data.tasks.filter(due)) {
        task.draftStage = ready.id;
        task.lastStage = ready.id;
        task.timing = null;
        task.updatedAt = this.stamp(task.updatedAt);
      }
    });
  }
  private async nightStarted(windowStart: number, title: string) {
    const key = new Date(windowStart).toISOString();
    await this.store.update((data) => {
      const runtime = data.nightRuntime;
      if (runtime.windowStart !== key) {
        runtime.windowStart = key;
        runtime.started = 0;
        runtime.shutdownAt = null;
      }
      runtime.started++;
      this.nightLog(data, `Started night task "${title}"`);
    });
  }
  /** Night tasks in Scheduled that an enabled orchestrator would still take. */
  private nightWaiting(data: Data = this.store.current): Task[] {
    return data.tasks.filter(
      (task) =>
        !task.workspaceId &&
        !hidden(task) &&
        task.timing?.kind === "night" &&
        groupKind(task.draftStage, data.settings.groups) === "scheduled",
    );
  }
  /** Why the night power-off must wait, or null when nothing holds it. */
  private async nightBlocker(windowStart: string): Promise<string | null> {
    const data = this.store.current;
    if (
      Object.values(data.orchestrations).some(
        (record) => record.night && nightBusy(record),
      )
    )
      return "night tasks are still running";
    const open =
      openWindowStart(nightSchedule(data.night), this.now()) ===
      Date.parse(windowStart);
    if (open) {
      const cards = new Map(this.snapshot().cards.map((c) => [c.id, c]));
      const startable = this.nightWaiting(data).some((task) => {
        const card = cards.get(task.id);
        return !!card && this.eligible(card) && this.taken(task, data);
      });
      if (startable) return "night tasks are still waiting";
    }
    if (
      Object.values(data.assistant.deliveries).some((delivery) =>
        DELIVERY_STEPS.has(delivery.stage),
      )
    )
      return "a delivery is in progress";
    // CUSTOM(resource-pools): a fix waiting for a pool slot is still work to do.
    if (Object.values(data.assistant.deliveries).some(fixWaits))
      return "a fix waits for a free slot";
    try {
      const busy = await this.host.busyAgents();
      if (busy.length)
        return busy.length === 1
          ? "an agent is running"
          : `${busy.length} agents are running`;
    } catch (error) {
      return `could not list the agents (${message(error)})`;
    }
    return null;
  }
  /**
   * With the option on, once the night's tasks are done (or its window closed) and no agent
   * runs, warn and count down; when the countdown ends and nothing started meanwhile, power off.
   */
  private async nightShutdown(): Promise<void> {
    const { night, nightRuntime: runtime } = this.store.current;
    const key = runtime.windowStart;
    if (key) {
      const open =
        openWindowStart(nightSchedule(night), this.now()) === Date.parse(key);
      const running = Object.values(this.store.current.orchestrations).some(
        (record) => record.night && nightBusy(record),
      );
      if (open || running) this.nightActiveAt = this.now();
    }
    const armed = runtime.shutdownAt;
    const disarm = (why: string) =>
      this.store.update((data) => {
        data.nightRuntime.shutdownAt = null;
        this.nightLog(data, `Power-off canceled: ${why}`);
      });
    if (
      !night.shutdownWhenDone ||
      !key ||
      runtime.started === 0 ||
      runtime.handledFor === key
    ) {
      if (armed) await disarm("the option is off");
      return;
    }
    if (!armed && this.now() - this.nightActiveAt > NIGHT_SHUTDOWN_GRACE_MS)
      return;
    const blocker = await this.nightBlocker(key);
    if (blocker) {
      if (armed) await disarm(blocker);
      return;
    }
    if (!armed) {
      const at = this.now() + SHUTDOWN_WARNING_MS;
      await this.store.update((data) => {
        data.nightRuntime.shutdownAt = new Date(at).toISOString();
        this.nightLog(
          data,
          "Night tasks are done; powering off in 5 minutes unless canceled",
        );
      });
      void this.nightSystem
        .notify(
          "Paseo will power off this computer in 5 minutes",
          "The night tasks are done. Open Workboard to cancel.",
        )
        .catch(() => undefined);
      return;
    }
    if (this.now() < Date.parse(armed)) return;
    // A countdown that ended long ago (Paseo was off) never powers off without a new warning.
    if (this.now() - Date.parse(armed) > SHUTDOWN_WARNING_MS) {
      await disarm("the countdown ended while Paseo was not running");
      return;
    }
    await this.store.update((data) => {
      data.nightRuntime.shutdownAt = null;
      data.nightRuntime.handledFor = key;
      this.nightLog(data, "Powering off");
    });
    try {
      await this.nightSystem.powerOff(night.shutdownCommand);
    } catch (error) {
      await this.store.update((data) => {
        this.nightLog(data, `Power-off failed: ${message(error)}`);
      });
    }
  }
  /** Wake up for the next start time or the end of a power-off countdown, sooner than the tick. */
  private armDueTimer(): void {
    clearTimeout(this.dueTimer);
    this.dueTimer = undefined;
    if (this.stopped) return;
    const data = this.store.current;
    const times = [
      ...data.tasks
        .filter((task) => !hidden(task) && task.timing?.kind === "at")
        .map((task) => Date.parse((task.timing as { at: string }).at)),
      ...(data.nightRuntime.shutdownAt
        ? [Date.parse(data.nightRuntime.shutdownAt)]
        : []),
      // CUSTOM(task-checkpoints): a checkpoint that waits until a time.
      ...Object.values(data.orchestrations)
        .filter((record) => record.status === "waiting" && record.resumeAt)
        .map((record) => Date.parse(record.resumeAt!)),
    ].filter((at) => Number.isFinite(at) && at > this.now());
    if (!times.length) return;
    const delay = Math.min(...times) - this.now() + 250;
    if (delay >= this.interval) return;
    this.dueTimer = setTimeout(() => {
      this.dueTimer = undefined;
      void this.refresh().catch(() => undefined);
    }, delay);
  }
  // -----------------------------------------------------------------------------------------
  /** Whether a Ready to start card may be started (or continued) now. */
  private eligible(card: Card): boolean {
    const record = this.store.current.orchestrations[card.id];
    if (card.binding || card.archived) return false;
    // A task sent back from review keeps its workspace and waits here.
    if (card.workspaceId)
      return (
        this.resumable(record) || // CUSTOM(task-checkpoints)
        (record?.status === "failed" &&
          record.feedback !== null &&
          Date.parse(card.updatedAt) > Date.parse(record.finishedAt ?? ""))
      );
    // A failed start is retried only after the task was edited.
    return (
      !record ||
      (record.status === "failed" &&
        !record.workspaceId &&
        Date.parse(card.updatedAt) > Date.parse(record.finishedAt ?? ""))
    );
  }
  /**
   * A task chosen for an orchestrator belongs to it; one sent back from review stays with the
   * orchestrator that ran it; any other task goes to the first orchestrator of its project, and
   * only a project without one leaves its tasks to the general ("All projects") orchestrators.
   */
  private owns(
    config: OrchestratorConfig,
    task: Pick<Task, "id" | "orchestratorId" | "projectId"> &
      Partial<Pick<Task, "pipeline" | "workspaceId">>,
    data: Data = this.store.current,
  ): boolean {
    // CUSTOM(factory): the worker of the pipeline stage the task is about to run.
    const stageOwner = this.stageOwner(task, data);
    if (stageOwner) return stageOwner === config.id;
    const exists = (id: string | null | undefined): id is string =>
      !!id && data.orchestrators.some((o) => o.id === id);
    if (exists(task.orchestratorId)) return task.orchestratorId === config.id;
    const ran = data.orchestrations[task.id]?.orchestratorId;
    if (exists(ran)) return ran === config.id;
    // CUSTOM(resource-pools): only the project's first orchestrator, even when it is disabled or
    // held by its pool; a second one of the same project takes only the tasks chosen for it.
    if (config.projectId !== null)
      return (
        data.orchestrators.find((o) => o.projectId === task.projectId)?.id ===
        config.id
      );
    // CUSTOM(resource-pools): a general orchestrator only takes tasks of projects without one.
    // Among general orchestrators a task the first can't take now still goes to the next.
    return (
      task.projectId === null ||
      !data.orchestrators.some((o) => o.projectId === task.projectId)
    );
  }
  /**
   * CUSTOM(no-orchestrator-warning): an enabled orchestrator takes the task, by the same rule the
   * runs use. False leaves a Ready to start task waiting with nobody to pick it up.
   */
  private taken(
    task: Pick<Task, "id" | "orchestratorId" | "projectId"> &
      Partial<Pick<Task, "pipeline" | "workspaceId">>,
    data: Data = this.store.current,
  ): boolean {
    return data.orchestrators.some(
      (o) => o.enabled && this.owns(o, task, data),
    );
  }
  /** The slots an orchestrator uses. */
  private runningFor(id: string, data: Data = this.store.current): number {
    return Object.values(data.orchestrations).filter(
      (record) => record.orchestratorId === id && this.usesSlot(record),
    ).length;
  }
  /**
   * A starting or running task, or (CUSTOM(resource-pools)) a finished task whose agent is in a
   * turn again, woken by the assistant or the user. An agent waiting on a permission or only on
   * background work doesn't count: it could hold the slot for hours.
   */
  private usesSlot(record: Orchestration): boolean {
    if (record.status === "starting" || record.status === "running")
      return true;
    // CUSTOM(task-checkpoints): queued and waiting too, when the agent runs a turn anyway.
    if (
      record.status !== "finished" &&
      record.status !== "failed" &&
      record.status !== "queued" &&
      record.status !== "waiting"
    )
      return false;
    const agent = record.agentId
      ? this.inventory.agents.find((a) => a.id === record.agentId)
      : undefined;
    return agent?.activity === "running" && agent.turnActive !== false;
  }
  /** CUSTOM(orchestrator-in-place): whether the task runs in the project folder. */
  private isInPlace(taskId: string): boolean {
    return this.store.current.orchestrations[taskId]?.inPlace === true;
  }
  // CUSTOM(resource-pools) ------------------------------------------------------------------
  /** The last free-RAM reading; refreshed on each pass while a pool has a RAM floor. */
  private memoryReading: MemoryReading | null = null;
  /** The hold last written to each orchestrator's log, so a long wait logs once. */
  private loggedHolds = new Map<string, string>();
  /** CUSTOM(orchestrator-in-place): the folder whose wait was last logged, by orchestrator. */
  private loggedFolderHolds = new Map<string, string>();
  /** CUSTOM(orchestrator-in-place): commit waits already logged, and their retry timers. */
  private loggedFolderCommitWaits = new Map<string, string>();
  private folderTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** CUSTOM(usage-limit): orchestrators whose Ready to start hold by the usage limit was logged. */
  private limitHoldLogged = new Set<string>();
  private poolOf(
    config: OrchestratorConfig,
    data: Data = this.store.current,
  ): Pool | null {
    return (
      data.settings.pools.find((pool) => pool.id === config.poolId) ?? null
    );
  }
  /**
   * The pool's used slots: its orchestrators' tasks that use a slot, plus the finished ones whose
   * delivery is still checking, committing, merging or fixing. That reserved slot keeps a failed
   * check or a conflict from losing its turn to a new task. `except` leaves one task out.
   */
  private runningInPool(
    poolId: string,
    data: Data = this.store.current,
    except?: string,
  ) {
    const members = new Set(
      data.orchestrators.filter((o) => o.poolId === poolId).map((o) => o.id),
    );
    return Object.entries(data.orchestrations).filter(
      ([taskId, record]) =>
        taskId !== except &&
        !!record.orchestratorId &&
        members.has(record.orchestratorId) &&
        (this.usesSlot(record) ||
          POOL_RESERVING_STAGES.has(
            data.assistant.deliveries[taskId]?.stage ?? "",
          ) ||
          // A fix that waited too long and went to Needs you keeps its slot too.
          fixWaits(data.assistant.deliveries[taskId])),
    ).length;
  }
  /** Reads the RAM when some pool has a floor; the snapshot RPC calls it so the status is current. */
  async readPoolMemory(): Promise<void> {
    if (
      !this.store.current.settings.pools.some(
        (pool) => pool.minFreeRamPercent !== null,
      )
    )
      return;
    this.memoryReading = await (this.assistantOptions.memory ?? readMemory)();
  }
  /** When the pool last started (or put back to work) an agent that still runs. */
  private lastStartInPool(poolId: string, data: Data): number | null {
    const members = new Set(
      data.orchestrators.filter((o) => o.poolId === poolId).map((o) => o.id),
    );
    let last: number | null = null;
    for (const record of Object.values(data.orchestrations)) {
      if (record.status !== "starting" && record.status !== "running") continue;
      if (!record.orchestratorId || !members.has(record.orchestratorId))
        continue;
      const at = Date.parse(record.startedAt);
      if (Number.isFinite(at) && (last === null || at > last)) last = at;
    }
    return last;
  }
  /** Why the pool lets nothing start now, or null when it has room. */
  private poolHold(
    pool: Pool,
    running: number,
    data: Data = this.store.current,
  ): OrchestratorHold | null {
    const free = this.memoryReading ? freeRamPercent(this.memoryReading) : null;
    const base = {
      poolId: pool.id,
      poolName: pool.name,
      running,
      maxConcurrent: pool.maxConcurrent,
      freeRamPercent: free,
      minFreeRamPercent: pool.minFreeRamPercent,
      until: null,
    };
    if (running >= pool.maxConcurrent) return { kind: "pool", ...base };
    // An unreadable RAM (no /proc/meminfo) never holds the pool.
    if (pool.minFreeRamPercent === null || free === null) return null;
    if (free < pool.minFreeRamPercent) return { kind: "ram", ...base };
    const last = this.lastStartInPool(pool.id, data);
    if (last !== null && this.now() - last < RAM_SETTLE_MS)
      return {
        kind: "settle",
        ...base,
        until: new Date(last + RAM_SETTLE_MS).toISOString(),
      };
    return null;
  }
  // CUSTOM(orchestrator-in-place) ----------------------------------------------------------
  /** The project folder a folder-mode task uses, or null for a worktree run. */
  private inPlaceFolder(
    config: OrchestratorConfig,
    card: Pick<Card, "projectId">,
  ): string | null {
    if (config.useWorktree) return null;
    const project = this.inventory.projects.find(
      (p) => p.id === (card.projectId ?? config.projectId),
    );
    return project?.directory ?? null;
  }
  /** The project folder a task runs in, or null for a worktree (or unknown workspace). */
  private folderDirectoryOf(
    taskId: string,
    record: Orchestration,
    data: Data = this.store.current,
  ): string | null {
    const task = data.tasks.find((t) => t.id === taskId);
    if (!task) return null;
    const workspace = this.inventory.workspaces.find(
      (w) => w.id === task.workspaceId,
    );
    // A task of the folder mode, or another orchestrated task in a project folder (a non-git
    // project): both use the same working tree. A manual start has no orchestration record, so it
    // is not in the queue; the commit check protects against it. A worktree task, or one whose
    // workspace is not known yet, never keeps a project folder.
    const folderTask =
      record.inPlace ||
      (workspace !== undefined && workspace.workspaceKind !== "worktree");
    if (!folderTask) return null;
    const projectId = task.projectId ?? workspace?.projectId ?? null;
    return (
      this.inventory.projects.find((p) => p.id === projectId)?.directory ?? null
    );
  }
  /**
   * CUSTOM(orchestrator-in-place): the project folders an orchestrated folder task keeps busy.
   * It stays busy from the start until its delivery is delivered or dismissed, or until the task
   * goes back to Backlog/Ready or to Done without a pending delivery. Review, Needs you and
   * checkpoints keep it. Worktrees never count. A manual start is not in this queue; the commit
   * check covers it.
   */
  private inPlaceDirectories(
    data: Data = this.store.current,
  ): Map<string, string> {
    const busy = new Map<string, string>();
    for (const [taskId, record] of Object.entries(data.orchestrations)) {
      const directory = this.folderDirectoryOf(taskId, record, data);
      if (!directory) continue;
      const task = data.tasks.find((t) => t.id === taskId)!;
      const stage = task.workspaceId ? task.lastStage : task.draftStage;
      const kind = groupKind(stage, data.settings.groups);
      const delivery = data.assistant.deliveries[taskId];
      const idle = !this.usesSlot(record);
      const released =
        idle &&
        (delivery?.stage === "delivered" ||
          delivery?.stage === "dismissed" ||
          kind === "todo" ||
          kind === "inbox" ||
          kind === "ready" ||
          kind === "canceled" ||
          (kind === "done" && !delivery));
      if (released) continue;
      busy.set(directory, task.title);
    }
    return busy;
  }
  /** The title of another board task whose agent is running in this folder, or null. */
  private runningFolderOccupant(
    taskId: string,
    directory: string,
  ): string | null {
    for (const task of this.store.current.tasks) {
      if (task.id === taskId || !task.workspaceId || task.archived) continue;
      const workspace = this.inventory.workspaces.find(
        (w) => w.id === task.workspaceId,
      );
      if (!workspace || workspace.workspaceDirectory !== directory) continue;
      const running = this.inventory.agents.some(
        (agent) =>
          agent.workspaceId === workspace.id &&
          !agent.archivedAt &&
          agent.activity === "running" &&
          agent.turnActive !== false,
      );
      if (running) return task.title;
    }
    return null;
  }
  /**
   * CUSTOM(orchestrator-in-place): a folder task's commit waits while another agent is still
   * running in the same folder, then tries again on the next pass.
   */
  private async waitForFolder(
    taskId: string,
    directory: string,
    occupant: string,
    stage: Delivery["stage"],
  ): Promise<void> {
    const reason = `Waiting: "${occupant}" is still running in ${directory}`;
    await this.serial(() => this.patchDelivery(taskId, { detail: reason }));
    if (this.loggedFolderCommitWaits.get(taskId) !== reason) {
      this.loggedFolderCommitWaits.set(taskId, reason);
      const record = this.store.current.orchestrations[taskId];
      await this.log(
        record?.orchestratorId,
        "info",
        reason,
        taskId,
        record?.agentId ?? null,
      );
    }
    if (this.stopped) return;
    this.clearFolderTimer(taskId);
    this.folderTimers.set(
      taskId,
      setTimeout(() => {
        this.folderTimers.delete(taskId);
        if (this.store.current.assistant.deliveries[taskId]?.stage === stage)
          this.launch(taskId);
      }, this.assistantOptions.folderRetryMs ?? this.interval),
    );
  }
  private clearFolderTimer(taskId: string): void {
    const timer = this.folderTimers.get(taskId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.folderTimers.delete(taskId);
  }
  /** Why this folder-mode orchestrator's next task waits for another task in its folder. */
  private folderHold(
    config: OrchestratorConfig,
    data: Data,
  ): OrchestratorHold | null {
    if (config.useWorktree) return null;
    const busy = this.inPlaceDirectories(data);
    if (!busy.size) return null;
    const readyStages = new Set(
      data.settings.groups
        .filter((group) => group.kind === "ready")
        .map((group) => group.id),
    );
    const next = data.tasks.find(
      (task) =>
        !task.archived &&
        readyStages.has(task.workspaceId ? task.lastStage : task.draftStage) &&
        this.owns(config, task, data),
    );
    if (!next) return null;
    const directory = this.inPlaceFolder(config, next);
    if (!directory || !busy.has(directory)) return null;
    return {
      kind: "folder",
      directory,
      taskTitle: busy.get(directory) ?? null,
    };
  }
  /** Log a folder wait once, so a long wait doesn't fill the log. */
  private async logFolderWait(
    id: string,
    directory: string,
    occupant: string,
  ): Promise<void> {
    const key = `${directory}\n${occupant}`;
    if (this.loggedFolderHolds.get(id) === key) return;
    this.loggedFolderHolds.set(id, key);
    await this.log(
      id,
      "info",
      `Waiting: "${occupant}" is not delivered yet in ${directory}`,
    );
  }
  // -----------------------------------------------------------------------------------------
  /**
   * Why this task's agent can't be put back to work now, or null. Only a pool holds it (full,
   * under its RAM floor, or settling); the task's own reserved slot doesn't count. Without a
   * pool the fix goes at once, as before. Inside `serial`.
   */
  private async reactivationHold(
    taskId: string,
    orchestratorId: string | null,
  ): Promise<OrchestratorHold | null> {
    const config = this.store.current.orchestrators.find(
      (o) => o.id === orchestratorId,
    );
    const pool = config && this.poolOf(config);
    if (!pool) return null;
    await this.readPoolMemory();
    return this.poolHold(
      pool,
      this.runningInPool(pool.id, this.store.current, taskId),
    );
  }
  private async logHold(
    id: string,
    hold: OrchestratorHold | null,
  ): Promise<void> {
    if (!hold) {
      this.loggedHolds.delete(id);
      return;
    }
    // The few minutes after each start are routine; the status shows them, the log doesn't.
    if (hold.kind === "settle") return;
    const key =
      hold.kind === "folder"
        ? `folder:${hold.directory}`
        : `${hold.kind}:${hold.poolId}`;
    if (this.loggedHolds.get(id) === key) return;
    this.loggedHolds.set(id, key);
    await this.log(id, "info", holdText(hold));
  }
  // -----------------------------------------------------------------------------------------
  private orchestratorConfig(id: string): OrchestratorConfig {
    const config = this.store.current.orchestrators.find((o) => o.id === id);
    if (!config) throw new Error("Orchestrator no longer exists");
    return config;
  }
  private runtime(
    id: string,
    data: Data = this.store.current,
  ): OrchestratorRuntime {
    return (
      data.orchestratorRuntime[id] ?? {
        quota: 0,
        started: 0,
        runStartedAt: null,
        lastTriggerAt: null,
      }
    );
  }
  private setRuntime(
    id: string,
    change: Partial<OrchestratorRuntime>,
  ): Promise<void> {
    return this.store.update((data) => {
      data.orchestratorRuntime[id] = { ...this.runtime(id, data), ...change };
    });
  }
  private async endRun(id: string, why: string): Promise<void> {
    const runtime = this.runtime(id);
    await this.setRuntime(id, { quota: 0, runStartedAt: null });
    await this.log(
      id,
      "info",
      `Run finished (${why}): ${runtime.started} started`,
    );
  }
  private log(
    id: string | null | undefined,
    level: "info" | "warn" | "error",
    text: string,
    taskId: string | null = null,
    agentId: string | null = null,
  ): Promise<void> {
    if (!id) return Promise.resolve();
    return this.store.update((data) => {
      if (!data.orchestrators.some((o) => o.id === id)) return;
      const entries = data.orchestratorLogs[id] ?? [];
      entries.push({ at: this.stamp(), level, text, taskId, agentId });
      data.orchestratorLogs[id] = entries.slice(-ORCHESTRATOR_LOG_LIMIT);
    });
  }
  private orchestratorStatus(config: OrchestratorConfig, data: Data) {
    const readyStages = new Set(
      data.settings.groups
        .filter((group) => group.kind === "ready")
        .map((group) => group.id),
    );
    const waiting = data.tasks.filter(
      (task) =>
        !task.archived &&
        readyStages.has(task.workspaceId ? task.lastStage : task.draftStage) &&
        this.owns(config, task, data),
    ).length;
    const next = config.enabled ? nextRunAt(config.schedule, this.now()) : null;
    const active =
      config.enabled &&
      (this.runtime(config.id, data).quota > 0 ||
        windowOpen(config.schedule, this.now()));
    // CUSTOM(resource-pools): waiting tasks the orchestrator would take now and has room for,
    // but its pool hasn't. A Manual orchestrator without a run, or a closed window, shows none.
    const pool = this.poolOf(config, data);
    const poolHold =
      pool &&
      active &&
      waiting > 0 &&
      this.runningFor(config.id, data) <
        (config.useWorktree ? config.maxConcurrent : 1)
        ? this.poolHold(pool, this.runningInPool(pool.id, data), data)
        : null;
    // CUSTOM(orchestrator-in-place): its next task waits for another task in the same folder.
    const folderHold =
      active && waiting > 0 ? this.folderHold(config, data) : null;
    const hold = folderHold ?? poolHold;
    return {
      hold,
      active,
      running: this.runningFor(config.id, data),
      waiting,
      // CUSTOM(task-checkpoints)
      paused: Object.values(data.orchestrations).filter(
        (record) =>
          record.orchestratorId === config.id &&
          record.checkpoint &&
          (record.status === "queued" || record.status === "waiting"),
      ).length,
      nextRunAt: next === null ? null : new Date(next).toISOString(),
    };
  }
  /** Start one Ready to start card for an orchestrator. "skipped" leaves its slot free. */
  private async startCard(
    config: OrchestratorConfig,
    card: Card,
    stage: Stage,
    night = false, // CUSTOM(night-tasks)
  ): Promise<"started" | "failed" | "skipped"> {
    if (card.workspaceId) return this.continueTask(card.id, stage, config);
    const project = this.inventory.projects.find(
      (p) => p.id === (card.projectId ?? config.projectId),
    );
    if (!project) {
      await this.setOrchestration(card.id, {
        status: "failed",
        startedAt: this.stamp(),
        finishedAt: this.stamp(),
        error: "Choose a project for this task",
        orchestratorId: config.id,
      });
      await this.log(
        config.id,
        "warn",
        `Skipped "${card.title}": choose a project for it`,
        card.id,
      );
      return "skipped";
    }
    await this.store.update((data) => {
      delete data.orchestrations[card.id];
    });
    // CUSTOM(orchestrator-in-place): a folder-mode task records the folder's starting point, so
    // the review can tell its work apart from what was already uncommitted.
    const inPlace = !config.useWorktree;
    let baseHead: string | null = null;
    let initialDirty: string[] = [];
    if (inPlace) {
      baseHead = await this.host.gitHead(project.directory).catch(() => null);
      initialDirty = await this.host
        .gitStatusLines(project.directory)
        .catch(() => []);
    }
    await this.setOrchestration(card.id, {
      status: "starting",
      orchestratorId: config.id,
      ...(await this.workerStamp(config)), // CUSTOM(factory)
      night,
      inPlace,
      baseHead,
      initialDirty,
      // CUSTOM(unattended-automation): a new run starts its own wait clock.
      permissionSince: null,
      permissionNeedsYou: false,
    });
    try {
      const source =
        project.isGit && config.useWorktree
          ? ({ kind: "worktree", projectId: project.id } as const)
          : ({
              kind: "directory",
              path: project.directory,
              projectId: project.id,
            } as const);
      await this.store.update((data) => {
        const task = data.tasks.find((t) => t.id === card.id)!;
        task.binding = {
          operationId: randomUUID(),
          target: { kind: "new", source },
          workspaceId: null,
          stage,
        };
        // A task without a project takes the orchestrator's.
        if (!task.projectId) {
          task.projectId = project.id;
          task.projectName = project.name;
        }
      });
      await this.bind(card.id);
      const task = this.task(card.id);
      if (!task.workspaceId) throw new Error("No workspace was created");
      await this.setOrchestration(card.id, {
        workspaceId: task.workspaceId,
      });
      // CUSTOM(factory): the task enters its pipeline at `start` (a `pm` start runs today's way).
      const entry = this.projectPipeline(project.id);
      const startStage =
        entry && findStage(entry.pipeline, entry.pipeline.start);
      const pipelineStart =
        entry && startStage && startStage.role !== "pm"
          ? { ...entry, stage: startStage }
          : null;
      const agentId = await this.host.startAgent(task.workspaceId, {
        ...(await this.orchestratorProfile(config)), // CUSTOM(agent-profiles)
        provider: config.provider,
        modeId: config.modeId,
        thinkingOptionId: config.thinkingOptionId,
        // CUSTOM(unattended-automation)
        unattended: runsUnattended(config),
        title: task.title,
        prompt: orchestratorPrompt(
          this.ticket(task),
          config.instructions,
          this.assistantOn(),
          this.testSection(task), // CUSTOM(packages)
          // CUSTOM(factory)
          pipelineStart
            ? await this.stagePrompt(
                pipelineStart.applied,
                pipelineStart.pipeline,
                pipelineStart.stage,
                project.id,
                { first: true },
              )
            : "",
        ), // CUSTOM(projects-assistant)
        labels: BOARD_AGENT_LABELS, // CUSTOM(hidden-board-agents)
      });
      await this.setOrchestration(card.id, {
        status: "running",
        agentId,
        startedAt: this.stamp(),
      });
      // CUSTOM(factory): a new run starts the pipeline over.
      if (pipelineStart) {
        const state = startPipeline(pipelineStart.pipeline, this.stamp());
        state.agents[pipelineStart.stage.role] = agentId;
        await this.setTaskPipeline(card.id, state);
      } else if (task.pipeline) await this.setTaskPipeline(card.id, null);
      // CUSTOM(projects-assistant)
      if (this.assistantOn()) {
        const attempt = await this.openAttempt(
          card.id,
          "start",
          agentId,
          config.id,
          null,
        );
        await this.record(card.id, "task-started", `Started "${task.title}"`, {
          attempt,
          agentId,
        });
      }
      await this.log(
        config.id,
        "info",
        `Started "${task.title}"`,
        card.id,
        agentId,
      );
      // CUSTOM(orchestrator-in-place): the folder may already hold the user's own work.
      if (initialDirty.length) {
        await this.record(
          card.id,
          "folder-dirty",
          `Started in a folder with ${initialDirty.length} uncommitted change(s)`,
          { detail: initialDirty.join("\n"), agentId },
        );
        await this.log(
          config.id,
          "warn",
          `"${task.title}": the project folder already had uncommitted changes (${initialDirty.length} files)`,
          card.id,
          agentId,
        );
      }
      return "started";
    } catch (error) {
      await this.setOrchestration(card.id, {
        status: "failed",
        finishedAt: this.stamp(),
        error: message(error),
      });
      await this.log(
        config.id,
        "error",
        `Could not start "${card.title}": ${message(error)}`,
        card.id,
      );
      return "failed";
    }
  }
  /** Hand the reviewer's feedback to the task's agent, or to a new one when it is gone. */
  private async continueTask(
    taskId: string,
    stage: Stage,
    settings: OrchestratorConfig,
  ): Promise<"started" | "failed"> {
    const record = this.store.current.orchestrations[taskId]!;
    const feedback = record.feedback ?? "";
    // CUSTOM(task-checkpoints)
    const checkpoint = record.checkpoint;
    const limited = checkpoint && record.limited; // CUSTOM(usage-limit)
    const progress = this.store.current.assistant.progress[taskId];
    const tests = this.testSection(this.task(taskId)); // CUSTOM(packages)
    // CUSTOM(factory): a stage a pipeline transition entered runs now, on the stage's worker.
    const live = this.taskPipeline(this.task(taskId));
    const stageRun =
      live?.state.pending && !checkpoint
        ? findStage(live.pipeline, live.state.stage)
        : null;
    const nextPrompt = stageRun
      ? stageRunPrompt(
          await this.stagePrompt(
            live!.applied,
            live!.pipeline,
            stageRun,
            this.projectIdOf(this.task(taskId)),
            {
              note:
                [live!.state.note, feedback.trim()]
                  .filter(Boolean)
                  .join("\n\n") || null,
            },
          ),
          this.assistantOn(),
          tests,
        )
      : limited
        ? usageLimitResumePrompt(progress, this.assistantOn(), tests)
        : checkpoint
          ? checkpointResumePrompt(
              progress,
              record.waitingFor,
              this.assistantOn(),
              tests,
            )
          : continuationPrompt(feedback, this.assistantOn(), tests); // CUSTOM(projects-assistant)
    // CUSTOM(usage-limit)
    const resumed = (title: string, fresh: boolean) =>
      limited
        ? `Resumed "${title}" after the usage limit reset${fresh ? " with a new agent" : ""}`
        : `Resumed "${title}" from checkpoint ${progress?.checkpoints ?? 1}${fresh ? " with a new agent" : ""}`;
    let fresh = false;
    try {
      await this.moveBound(taskId, stage);
      const task = this.task(taskId);
      // CUSTOM(factory): `session: continue` hands the stage to the role's last agent here;
      // `fresh` always starts a new one.
      // A continuation of the current stage goes to that stage's role agent: after a rework
      // from `deliver`, the implement agent, not the reviewer that ran last.
      const liveStage = live && findStage(live.pipeline, live.state.stage);
      let agentId = stageRun
        ? stageRun.session === "fresh"
          ? null
          : (live!.state.agents[stageRun.role] ?? null)
        : liveStage && liveStage.role !== "pm"
          ? (live!.state.agents[liveStage.role] ?? record.agentId)
          : record.agentId;
      // CUSTOM(factory): a new agent starts from the current config; a live one keeps its stamp.
      let stamp: RevisionStamp | null = null;
      if (agentId && (await this.host.agentAlive(agentId)))
        await this.host.sendAgent(agentId, nextPrompt);
      else {
        fresh = true;
        stamp = await this.workerStamp(settings);
        agentId = await this.host.startAgent(task.workspaceId!, {
          ...(await this.orchestratorProfile(settings)), // CUSTOM(agent-profiles)
          provider: settings.provider,
          modeId: settings.modeId,
          thinkingOptionId: settings.thinkingOptionId,
          // CUSTOM(unattended-automation)
          unattended: runsUnattended(settings),
          title: task.title,
          prompt: [
            orchestratorPrompt(
              this.ticket(task),
              settings.instructions,
              false,
              tests,
            ),
            // CUSTOM(task-checkpoints): the new agent gets the checklist, last summary and branch.
            handoffSection({
              progress,
              summary: progress?.summary ?? record.summary,
              branch: await this.taskBranch(task),
            }),
            nextPrompt,
          ].join("\n\n"),
          labels: BOARD_AGENT_LABELS, // CUSTOM(hidden-board-agents)
        });
      }
      await this.setOrchestration(taskId, {
        status: "running",
        agentId,
        startedAt: this.stamp(),
        finishedAt: null,
        sawRunning: false,
        idleSince: null,
        summary: null,
        feedback: null,
        error: null,
        orchestratorId: settings.id,
        // CUSTOM(unattended-automation)
        permissionSince: null,
        permissionNeedsYou: false,
        // CUSTOM(night-tasks): a continuation runs whenever it is taken.
        // CUSTOM(task-checkpoints): a resumed night task stays one, for the night power-off.
        night: checkpoint ? record.night : false,
        checkpoint: false, // CUSTOM(task-checkpoints)
        resumeAt: null,
        waitingFor: null,
        // CUSTOM(usage-limit): only a resume after the limit keeps counting pauses.
        limited: false,
        limitPauses: limited ? (record.limitPauses ?? 0) : 0,
        ...stamp, // CUSTOM(factory)
      });
      // CUSTOM(factory): the stage runs; its agent continues the role's next stage. A pending
      // stage left over from active mode runs as a plain continuation and stops being pending.
      const pipelineNow = this.task(taskId).pipeline;
      if (pipelineNow && (stageRun || pipelineNow.pending))
        await this.setTaskPipeline(taskId, {
          ...pipelineNow,
          pending: false,
          note: null,
          agents: stageRun
            ? { ...pipelineNow.agents, [stageRun.role]: agentId! }
            : pipelineNow.agents,
        });
      const stageText = stageRun
        ? `Started stage "${stageRun.id}" of "${task.title}"${fresh ? " with a new agent" : ""}`
        : null;
      // CUSTOM(projects-assistant)
      if (this.assistantOn()) {
        const attempt = await this.openAttempt(
          taskId,
          // CUSTOM(task-checkpoints), CUSTOM(usage-limit), CUSTOM(factory)
          stageRun
            ? "start"
            : limited
              ? "usage-limit"
              : checkpoint
                ? "checkpoint"
                : "feedback",
          agentId,
          settings.id,
          checkpoint || stageRun ? null : feedback.trim() || null,
        );
        await this.record(
          taskId,
          "task-continued",
          stageText ??
            (checkpoint
              ? resumed(task.title, fresh)
              : `Continued "${task.title}" with the review feedback`),
          {
            attempt,
            agentId,
            detail: checkpoint ? null : feedback.trim() || null,
            // CUSTOM(assistant-cards): the feedback's author; a checkpoint resume is the board's.
            by:
              checkpoint || stageRun
                ? "orchestrator"
                : (record.feedbackBy ?? "orchestrator"),
          },
        );
      }
      await this.log(
        settings.id,
        "info",
        stageText ??
          (checkpoint
            ? resumed(task.title, fresh)
            : `Continued "${task.title}" with the review feedback`),
        taskId,
        agentId,
      );
      return "started";
    } catch (error) {
      await this.setOrchestration(taskId, {
        status: "failed",
        finishedAt: this.stamp(),
        error: message(error),
        checkpoint: false, // CUSTOM(task-checkpoints)
        resumeAt: null,
        waitingFor: null,
        limited: false, // CUSTOM(usage-limit)
      });
      await this.log(
        settings.id,
        "error",
        `Could not continue the task: ${message(error)}`,
        taskId,
      );
      // CUSTOM(task-checkpoints): a resume nobody retries goes to the user, not to a dead end.
      // CUSTOM(factory): so does a pipeline stage that could not start.
      if ((checkpoint || stageRun) && this.assistantOn())
        await this.assistantFailed(
          taskId,
          this.store.current.orchestrations[taskId],
          stageRun
            ? `Could not start the "${stageRun.id}" stage: ${message(error)}`
            : limited
              ? `Could not resume after the usage limit: ${message(error)}`
              : `Could not resume from the checkpoint: ${message(error)}`,
        );
      return "failed";
    }
  }
  private issue(id: string, issue: string | null): Promise<void> {
    return this.store.update((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (task) task.issue = issue;
    });
  }
  private archiveFingerprint(
    workspace: Workspace | undefined,
    agents: readonly Agent[],
  ): string {
    return JSON.stringify([
      workspace && [
        workspace.id,
        [...workspace.labels].sort(),
        workspace.archivingAt,
        workspace.status,
        workspace.scripts,
        workspace.workspaceDirectory,
        workspace.gitRuntime?.isPaseoOwnedWorktree,
      ],
      [...agents]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((agent) => [
          agent.id,
          agent.updatedAt,
          agent.lastUserMessageAt,
          agent.activity,
          agent.archivedAt,
          agent.childEnumeration,
          agent.parentAgentId,
          agent.subagentId,
        ]),
    ]);
  }
  private archiveDeferred(
    task: Task,
    workspace: Workspace | undefined,
    agents: readonly Agent[],
  ): boolean {
    const deferred = this.archiveDeferrals.get(task.id);
    if (!deferred) return false;
    if (deferred.fingerprint !== this.archiveFingerprint(workspace, agents)) {
      this.archiveDeferrals.delete(task.id);
      return false;
    }
    return deferred.deferredUntil > this.now();
  }
  private async deferArchive(
    task: Task,
    reason: string,
    workspace: Workspace | undefined,
    agents: readonly Agent[],
  ): Promise<void> {
    const prior = this.archiveDeferrals.get(task.id);
    const attempts =
      prior?.reason === reason ? Math.min(prior.attempts + 1, 7) : 1;
    this.archiveDeferrals.set(task.id, {
      reason,
      attempts,
      deferredUntil:
        this.now() + Math.min(60_000 * 2 ** (attempts - 1), 3_600_000),
      fingerprint: this.archiveFingerprint(workspace, agents),
    });
    await this.issue(task.id, reason);
  }
  private async scan(scope?: ReadonlySet<string>): Promise<void> {
    if (!this.connected || !this.store.current.settings.autoArchive) return;
    const tasks = this.store.current.tasks;
    for (const id of this.archiveDeferrals.keys())
      if (
        !tasks.some((task) => task.id === id && !task.archived && !task.binding)
      )
        this.archiveDeferrals.delete(id);
    const candidates = tasks.filter((task) => {
      const id = task.workspaceId;
      return (
        id &&
        (!scope || scope.has(id)) &&
        !task.archived &&
        !task.binding &&
        task.issue !== "archive-restored-workspace-unavailable" &&
        // CUSTOM(done-auto-archive): only task worktrees. A local checkout's workspace holds the
        // user's other chats, and its branch is always "merged" into itself.
        this.inventory.workspaces.find((w) => w.id === id)?.workspaceKind ===
          "worktree" &&
        archiveGate(task) !== null &&
        isArchiveDue(
          groupKind(task.lastStage, this.store.current.settings.groups),
          archiveGate(task),
          this.now(),
          this.store.current.settings.archiveAfterDays,
        ) &&
        !this.archiveDeferred(
          task,
          this.inventory.workspaces.find((w) => w.id === id),
          this.inventory.agents.filter((a) => a.workspaceId === id),
        )
      );
    });
    if (!candidates.length || this.stopped || this.pendingMutations > 0) return;
    const epochs = new Map(
      candidates.map((task) => [task.id, this.observation(task.workspaceId!)]),
    );
    const inventory = await this.inventoryNow();
    for (const candidate of candidates) {
      if (this.stopped || this.pendingMutations > 0) return;
      const id = candidate.workspaceId!;
      const epoch = epochs.get(candidate.id)!;
      const workspace = inventory.workspaces.find((w) => w.id === id);
      if (!workspace || workspace.archivingAt) {
        await this.deferArchive(
          candidate,
          "workspace-unavailable",
          workspace,
          inventory.agents.filter((a) => a.workspaceId === id),
        );
        continue;
      }
      const stage = resolveStage(
        workspace.labels,
        this.store.current.settings.groups,
        this.store.current.settings.defaultStartGroup,
      );
      const agents = inventory.agents.filter(
        (agent) => agent.workspaceId === id,
      );
      if (
        agents.some(
          (a) =>
            !a.archivedAt &&
            (a.activity === "running" || a.activity === "waiting"),
        ) ||
        workspace.status === "running" ||
        workspace.status === "needs_input"
      ) {
        await this.deferArchive(candidate, "agent-busy", workspace, agents);
        continue;
      }
      const gate = await this.verifyConversation(candidate, agents);
      if (gate === null) {
        await this.deferArchive(
          candidate,
          "conversation-unknown",
          workspace,
          agents,
        );
        continue;
      }
      if (
        !isArchiveDue(
          groupKind(stage, this.store.current.settings.groups),
          gate,
          this.now(),
          this.store.current.settings.archiveAfterDays,
        )
      ) {
        this.archiveDeferrals.delete(candidate.id);
        continue;
      }
      const safety = await this.host.safety(
        workspace,
        this.policy(this.projectIdOf(candidate)).baseBranch.trim() || null,
      );
      if (safety) {
        await this.deferArchive(candidate, safety, workspace, agents);
        continue;
      }
      if (this.stopped || epoch !== this.observation(id)) {
        if (!this.stopped)
          await this.deferArchive(
            candidate,
            "changed-during-check",
            workspace,
            agents,
          );
        continue;
      }
      const operationId = randomUUID();
      await this.store.update((data) => {
        data.tasks.find((t) => t.id === candidate.id)!.archived = {
          operationId,
          kind: "automatic",
          status: "pending",
          stage,
          group:
            data.settings.groups.find((group) => group.id === stage) ?? null,
          startedAt: this.stamp(),
          archivedAt: null,
          lastConversationAt: candidate.lastConversationAt,
          detail: "Archive intent persisted; native result not yet known",
        };
      });
      // Storage and safety checks can take time. Re-read membership, labels and Agent state before sending.
      let finalIssue: string | null = null;
      try {
        const fresh = await this.inventoryNow();
        const current = fresh.workspaces.find((w) => w.id === id);
        const currentAgents = fresh.agents.filter((a) => a.workspaceId === id);
        const fingerprint = (items: typeof agents) =>
          JSON.stringify(
            items
              .map((a) => [
                a.id,
                a.updatedAt,
                a.lastUserMessageAt,
                a.activity,
                a.archivedAt,
                a.childEnumeration,
              ])
              .sort(),
          );
        if (
          !current ||
          current.archivingAt ||
          current.status === "running" ||
          current.status === "needs_input" ||
          // A refused child listing for an archived parent keeps the gate on its recorded
          // bounds, so it must not defer the archive forever as a state change would.
          resolveStage(
            current.labels,
            this.store.current.settings.groups,
            this.store.current.settings.defaultStartGroup,
          ) !== stage ||
          !labelsEqual(current.labels, workspace.labels) ||
          fingerprint(currentAgents) !== fingerprint(agents)
        )
          finalIssue = "changed-during-check";
        else
          finalIssue = await this.host.safety(
            current,
            this.policy(this.projectIdOf(candidate)).baseBranch.trim() || null,
          );
      } catch {
        finalIssue = "changed-during-check";
      }
      if (this.stopped) return; // Keep the persisted intent uncertain on the next startup.
      if (epoch !== this.observation(id)) finalIssue = "changed-during-check";
      if (finalIssue) {
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === candidate.id)!;
          task.archived = null;
          task.issue = finalIssue;
        });
        await this.deferArchive(candidate, finalIssue, workspace, agents);
        continue;
      }
      this.archiveDeferrals.delete(candidate.id);
      try {
        const result = await this.host.archive(id);
        if (result.error || !result.archivedAt)
          throw new Error(
            result.error ?? "Native archive returned no timestamp",
          );
        const active = await this.inventoryNow();
        this.inventory = active;
        if (active.workspaces.some((w) => w.id === id))
          throw new Error(
            "Native workspace still active after archive response",
          );
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === candidate.id)!;
          task.archived = {
            ...task.archived!,
            status: "archived",
            archivedAt: result.archivedAt,
            detail:
              "Native archive confirmed; worktree cleanup is not independently verified",
          };
          task.issue = null;
        });
      } catch (error) {
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === candidate.id)!;
          task.archived = {
            ...task.archived!,
            status: "uncertain",
            detail: message(error),
          };
          task.issue = "native-archive-unknown";
        });
      }
    }
  }
  dispose(): void {
    this.stopped = true;
    this.epoch++;
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    clearTimeout(this.settleTimer);
    clearTimeout(this.wakeTimer); // CUSTOM(assistant-wake)
    clearTimeout(this.reloadTimer); // CUSTOM(assistant-wake)
    this.wakeDueAt = null; // CUSTOM(assistant-wake)
    clearTimeout(this.compactTimer); // CUSTOM(assistant-compact)
    for (const timer of this.dirtyTimers.values()) clearTimeout(timer); // CUSTOM(assistant-autonomy)
    this.dirtyTimers.clear();
    for (const timer of this.folderTimers.values()) clearTimeout(timer); // CUSTOM(orchestrator-in-place)
    this.folderTimers.clear();
    clearTimeout(this.dueTimer); // CUSTOM(night-tasks)
    for (const controller of this.gateAbort.values()) controller.abort();
    this.gateAbort.clear();
    this.packageGates.clear();
    this.host.dispose();
  }
}
