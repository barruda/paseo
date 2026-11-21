// CUSTOM(projects-assistant): read-side views for the Projects Dashboard and Projects
// Conversations. Pure functions over the board's data, the inventory's agents and the history.
import type {
  Attempt,
  Conversation,
  ConversationItem,
  DeliveryStage,
  HistoryEvent,
  NeedsYouItem,
  Overview,
  RunningItem,
  Stats,
  Tree,
} from "../../shared/assistant";
import type { Board, Card, Data, Task } from "../../shared/model";
import { buildPmOverview } from "../../shared/pm-board"; // CUSTOM(pm-board)
import { packageViews } from "../../shared/packages"; // CUSTOM(packages)
import type { TimelineReader } from "../conversations";
import type { Agent } from "../host";
import { localDay } from "./history";

export interface ViewSource {
  /** The stored data (`store.current`), including `assistant`, `orchestrations`, `orchestrators`. */
  data: Data;
  /** The board snapshot: cards with their columns, groups, projects, orchestrator status. */
  board: Board;
  /** The inventory's agents (tracked workspaces only). */
  agents: Agent[];
  now: Date;
  /** CUSTOM(assistant-wake): when the pending wake fires; absent when none is armed. */
  notifyAt?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STAGES: ReadonlySet<DeliveryStage> = new Set([
  "verifying",
  "fixing",
  "committing",
  "merging",
  "preparing-pr",
]);
const TEXT_CAP = 4096;

const isArchived = (task: Task) =>
  task.archived?.status === "archived" || task.archived?.status === "external";
const time = (iso: string | null | undefined) => {
  const value = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(value) ? value : 0;
};
const MESSAGE_CAP = 200 * 1024;
const cap = (text: string, limit = TEXT_CAP) =>
  text.length > limit ? `${text.slice(0, limit)}...` : text;

function taskAttempts(data: Data, taskId: string): Attempt[] {
  return data.assistant?.attempts?.[taskId] ?? [];
}

function orchestratorIdOf(data: Data, task: Task): string | null {
  const attempts = taskAttempts(data, task.id);
  return (
    task.orchestratorId ??
    attempts.find((attempt) => attempt.orchestratorId)?.orchestratorId ??
    data.orchestrations?.[task.id]?.orchestratorId ??
    null
  );
}

function currentAgentId(data: Data, taskId: string): string | null {
  const attempts = taskAttempts(data, taskId);
  for (let i = attempts.length - 1; i >= 0; i--) {
    const id = attempts[i].agentId;
    if (id) return id;
  }
  return data.orchestrations?.[taskId]?.agentId ?? null;
}

function orchestratorName(data: Data, id: string | null): string | null {
  if (id === null) return null;
  return data.orchestrators?.find((item) => item.id === id)?.name ?? null;
}

function queuedCount(board: Board): number {
  const groups = board.settings?.groups ?? [];
  const ready = new Set(
    groups.filter((group) => group.kind === "ready").map((g) => g.id),
  );
  return (board.cards ?? []).filter(
    (card: Card) =>
      ready.has(card.stage) &&
      card.archived?.status !== "archived" &&
      card.archived?.status !== "external",
  ).length;
}

/** CUSTOM(task-checkpoints): a long task's checklist as counts for the Running section. */
function progressOf(data: Data, taskId: string): RunningItem["progress"] {
  const progress = data.assistant?.progress?.[taskId];
  if (!progress) return null;
  return {
    done: progress.done.length,
    total: progress.done.length + progress.next.length,
    checkpoints: progress.checkpoints,
  };
}

export function buildOverview(source: ViewSource): Overview {
  const { data, board } = source;
  const tasks = new Map(data.tasks.map((task) => [task.id, task]));
  const projects = new Map(
    (board.projects ?? []).map((project) => [project.id, project]),
  );
  const needsYou: NeedsYouItem[] = [];
  const running: RunningItem[] = [];
  // CUSTOM(packages): Needs you groups by package.
  const packageNames = new Map(
    (data.packages ?? []).map((pkg) => [pkg.id, pkg.name]),
  );
  const seenRunning = new Set<string>();
  // CUSTOM(assistant-wake): only a chat that will be told gets a countdown.
  const canNotify =
    (data.assistant?.settings?.chat.wakeOnNeedsYou ?? false) &&
    !!data.assistant?.chatAgentId;

  for (const [taskId, delivery] of Object.entries(
    data.assistant?.deliveries ?? {},
  )) {
    const task = tasks.get(taskId);
    if (!task || isArchived(task)) continue;
    const attempts = taskAttempts(data, taskId);
    const orchestratorId = orchestratorIdOf(data, task);
    if (delivery.stage === "needs-you") {
      needsYou.push({
        taskId,
        title: task.title,
        projectId: task.projectId,
        projectName: task.projectName,
        orchestratorId,
        orchestratorName: orchestratorName(data, orchestratorId),
        agentId: currentAgentId(data, taskId),
        reason: delivery.reason ?? "notify",
        detail: delivery.detail,
        report: delivery.report,
        attempt: attempts.length
          ? attempts[attempts.length - 1].index
          : delivery.attempt,
        since: delivery.updatedAt,
        // CUSTOM(assistant-wake)
        notifyAt:
          canNotify && !delivery.toldAt ? (source.notifyAt ?? null) : null,
        toldAt: delivery.firstToldAt ?? delivery.toldAt ?? null,
        canMerge:
          task.projectId !== null &&
          projects.get(task.projectId)?.isGit === true &&
          task.workspaceId !== null &&
          // CUSTOM(orchestrator-in-place): its work is already on the folder's branch.
          data.orchestrations?.[taskId]?.inPlace !== true,
        // CUSTOM(resource-pools)
        hold:
          delivery.reason === "fix-waiting"
            ? (delivery.queuedFix?.hold ?? null)
            : null,
        // CUSTOM(packages)
        packageId: task.packageId ?? null,
        packageName: task.packageId
          ? (packageNames.get(task.packageId) ?? null)
          : null,
      });
    } else if (ACTIVE_STAGES.has(delivery.stage)) {
      seenRunning.add(taskId);
      running.push({
        taskId,
        title: task.title,
        projectName: task.projectName,
        orchestratorName: orchestratorName(data, orchestratorId),
        agentId: currentAgentId(data, taskId),
        stage: delivery.stage,
        attempt: delivery.attempt,
        startedAt: delivery.startedAt,
        progress: progressOf(data, taskId), // CUSTOM(task-checkpoints)
        hold: delivery.queuedFix?.hold ?? null, // CUSTOM(resource-pools)
      });
    }
  }
  for (const [taskId, run] of Object.entries(data.orchestrations ?? {})) {
    // CUSTOM(task-checkpoints): a task between checkpoints is listed as waiting.
    const waiting =
      run.checkpoint && (run.status === "queued" || run.status === "waiting");
    if (
      seenRunning.has(taskId) ||
      (run.status !== "running" && run.status !== "starting" && !waiting)
    )
      continue;
    const task = tasks.get(taskId);
    if (!task || isArchived(task)) continue;
    const attempts = taskAttempts(data, taskId);
    const orchestratorId = orchestratorIdOf(data, task);
    running.push({
      taskId,
      title: task.title,
      projectName: task.projectName,
      orchestratorName: orchestratorName(data, orchestratorId),
      agentId: currentAgentId(data, taskId),
      stage: waiting ? "waiting" : "running",
      attempt: attempts.length ? attempts[attempts.length - 1].index : null,
      startedAt: waiting ? (run.finishedAt ?? run.startedAt) : run.startedAt,
      // CUSTOM(task-checkpoints)
      resumeAt: waiting ? run.resumeAt : null,
      waitingFor: waiting ? run.waitingFor : null,
      limited: waiting && run.limited ? true : undefined, // CUSTOM(usage-limit)
      progress: progressOf(data, taskId),
    });
  }
  needsYou.sort((left, right) => time(right.since) - time(left.since));
  running.sort((left, right) => time(right.startedAt) - time(left.startedAt));
  // CUSTOM(packages): the open packages and their last gate, for the PM overview and tools.
  const packages = packageViews(data, board.projects ?? [])
    .filter((pkg) => pkg.status === "open")
    .map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      projectName: pkg.projectName,
      status: pkg.status,
      total: pkg.total,
      merged: pkg.merged,
      gate: pkg.lastRun?.status ?? ("none" as const),
      suspectTaskIds: pkg.suspectTaskIds,
      since: pkg.lastRun?.finishedAt ?? pkg.createdAt,
    }));
  return {
    enabled: data.assistant?.settings?.enabled ?? true,
    needsYou,
    running,
    queued: queuedCount(board),
    pm: buildPmOverview(data.assistant?.pmBoard, packages), // CUSTOM(pm-board, packages)
  };
}

interface Counts {
  done: number;
  merged: number;
  failed: number;
  needsYou: number;
}
const zero = (): Counts => ({ done: 0, merged: 0, failed: 0, needsYou: 0 });
function count(counts: Counts, kind: HistoryEvent["kind"]) {
  if (kind === "done") counts.done += 1;
  else if (kind === "merged") counts.merged += 1;
  else if (kind === "failed") counts.failed += 1;
  else if (kind === "needs-you") counts.needsYou += 1;
}

/** `events`: the history since the start of the period (oldest first). */
export function buildStats(
  source: ViewSource,
  events: HistoryEvent[],
  days: number,
): Stats {
  const span = Math.max(1, Math.floor(days));
  const start = new Date(source.now);
  start.setHours(12, 0, 0, 0);
  const dates: string[] = [];
  for (let offset = span - 1; offset >= 0; offset--)
    dates.push(localDay(new Date(start.getTime() - offset * DAY_MS)));
  const perDay = new Map(dates.map((date) => [date, zero()]));
  const projects = new Map<
    string,
    Counts & { projectId: string | null; projectName: string }
  >();
  const orchestrators = new Map<
    string,
    Counts & { orchestratorId: string | null; name: string }
  >();
  const today = dates[dates.length - 1];
  let doneToday = 0;
  let doneInPeriod = 0;
  let mergedInPeriod = 0;
  const doneByTask = new Map<string, HistoryEvent>();

  for (const event of events) {
    const date = localDay(new Date(event.at));
    const day = perDay.get(date);
    if (!day) continue;
    count(day, event.kind);
    const projectKey = event.projectId ?? "";
    const project =
      projects.get(projectKey) ??
      projects
        .set(projectKey, {
          ...zero(),
          projectId: event.projectId,
          projectName: event.projectName,
        })
        .get(projectKey)!;
    count(project, event.kind);
    const orchestratorKey = event.orchestratorId ?? "";
    const orchestrator =
      orchestrators.get(orchestratorKey) ??
      orchestrators
        .set(orchestratorKey, {
          ...zero(),
          orchestratorId: event.orchestratorId,
          name: event.orchestratorName ?? "Started by hand",
        })
        .get(orchestratorKey)!;
    count(orchestrator, event.kind);
    if (event.kind === "done") {
      doneInPeriod += 1;
      if (date === today) doneToday += 1;
      doneByTask.set(event.taskId, event);
    } else if (event.kind === "merged") mergedInPeriod += 1;
  }

  let firstTry = 0;
  let attemptSum = 0;
  const durations: number[] = [];
  for (const [taskId, event] of doneByTask) {
    const attempts = taskAttempts(source.data, taskId);
    const attempt = event.attempt ?? attempts.length;
    if (attempt === 1) firstTry += 1;
    if (attempt > 0) attemptSum += attempt;
    const first = attempts[0];
    if (first) {
      const duration = time(event.at) - time(first.startedAt);
      if (duration >= 0) durations.push(duration);
    }
  }
  const finished = doneByTask.size;
  const overview = buildOverview(source);
  const byName = <T extends { projectName?: string; name?: string }>(
    a: T,
    b: T,
  ) =>
    (a.projectName ?? a.name ?? "").localeCompare(
      b.projectName ?? b.name ?? "",
    );
  return {
    days: span,
    totals: {
      doneToday,
      doneInPeriod,
      mergedInPeriod,
      firstTryRate: finished ? firstTry / finished : null,
      averageAttempts: finished ? attemptSum / finished : null,
      averageDurationMs: durations.length
        ? durations.reduce((sum, value) => sum + value, 0) / durations.length
        : null,
      // CUSTOM(task-checkpoints): tasks between checkpoints are not running.
      running: overview.running.filter((item) => item.stage !== "waiting")
        .length,
      queued: overview.queued,
      needsYou: overview.needsYou.length,
    },
    perDay: dates.map((date) => ({ date, ...perDay.get(date)! })),
    perProject: [...projects.values()].sort(byName),
    perOrchestrator: [...orchestrators.values()].sort(byName),
  };
}

export function buildTree(source: ViewSource): Tree {
  const { data, board } = source;
  const agents = new Map(source.agents.map((agent) => [agent.id, agent]));
  const cards = new Map((board.cards ?? []).map((card) => [card.id, card]));
  const groups = new Map(
    (board.settings?.groups ?? []).map((group) => [group.id, group]),
  );
  const known = new Set((data.orchestrators ?? []).map((item) => item.id));
  const cutoff = source.now.getTime() - 30 * DAY_MS;
  const byOrchestrator = new Map<
    string | null,
    Tree["orchestrators"][number]["tasks"]
  >();

  const tasks = [...data.tasks].sort(
    (left, right) => time(right.updatedAt) - time(left.updatedAt),
  );
  for (const task of tasks) {
    const attempts = taskAttempts(data, task.id);
    const run = data.orchestrations?.[task.id];
    if (!attempts.length && !run) continue;
    if (isArchived(task) || time(task.updatedAt) < cutoff) continue;
    const ids: string[] = [];
    const attemptOf = new Map<string, number>();
    for (const attempt of attempts) {
      if (!attempt.agentId) continue;
      if (!ids.includes(attempt.agentId)) ids.push(attempt.agentId);
      attemptOf.set(attempt.agentId, attempt.index);
    }
    if (run?.agentId && !ids.includes(run.agentId)) ids.push(run.agentId);
    const card = cards.get(task.id);
    const group = card ? groups.get(card.stage) : undefined;
    const owner = orchestratorIdOf(data, task);
    const key = owner !== null && known.has(owner) ? owner : null;
    const list = byOrchestrator.get(key) ?? [];
    list.push({
      taskId: task.id,
      title: task.title,
      projectName: task.projectName,
      column: group ? (group.name ?? group.label) : (card?.stage ?? ""),
      deliveryStage: data.assistant?.deliveries?.[task.id]?.stage ?? null,
      updatedAt: task.updatedAt,
      agents: ids.map((agentId, index) => {
        const agent = agents.get(agentId);
        return {
          agentId,
          title: agent?.title ?? null,
          status: agent ? agent.activity : "gone",
          attempt: attemptOf.get(agentId) ?? null,
          current: index === ids.length - 1,
        };
      }),
    });
    byOrchestrator.set(key, list);
  }

  const projectNames = new Map(
    (board.projects ?? []).map((project) => [project.id, project.name]),
  );
  const result: Tree["orchestrators"] = (data.orchestrators ?? []).map(
    (config) => ({
      id: config.id,
      name: config.name,
      projectName: config.projectId
        ? (projectNames.get(config.projectId) ?? null)
        : null,
      active: board.orchestratorStatus?.[config.id]?.active ?? false,
      tasks: byOrchestrator.get(config.id) ?? [],
    }),
  );
  const manual = byOrchestrator.get(null);
  if (manual?.length)
    result.push({
      id: null,
      name: "Started by hand",
      projectName: null,
      active: false,
      tasks: manual,
    });
  return { orchestrators: result };
}

type ToolDetail = { type?: string; [key: string]: unknown };
const str = (value: unknown) => (typeof value === "string" ? value : "");

function toolText(item: { detail?: ToolDetail; error?: unknown }): string {
  const detail = item.detail;
  let text = "";
  if (detail) {
    switch (detail.type) {
      case "shell":
        text = [str(detail.command), str(detail.output)]
          .filter(Boolean)
          .join("\n");
        break;
      case "read":
      case "edit":
      case "write":
        text = str(detail.filePath);
        break;
      case "search":
        text = str(detail.query);
        break;
      case "fetch":
        text = str(detail.url);
        break;
      case "sub_agent":
        text = str(detail.description) || str(detail.subAgentType);
        break;
      case "plain_text":
        text = [str(detail.label), str(detail.text)].filter(Boolean).join(": ");
        break;
      case "plan":
        text = str(detail.text);
        break;
      case "worktree_setup":
        text = str(detail.branchName);
        break;
      default:
        try {
          text =
            JSON.stringify({ input: detail.input, output: detail.output }) ??
            "";
        } catch {
          text = "";
        }
    }
  }
  if (!text && item.error)
    text = typeof item.error === "string" ? item.error : "error";
  return cap(text);
}

export async function readConversation(
  source: ViewSource,
  agentId: string,
  read: TimelineReader,
  input: { before: { epoch: string; seq: number } | null; limit: number },
): Promise<Conversation> {
  const { data } = source;
  const page = await read({
    direction: input.before ? "before" : "tail",
    cursor: input.before ?? undefined,
    limit: input.limit,
  });
  const items: ConversationItem[] = [];
  const base = page.startCursor?.seq;
  let merging: ConversationItem | null = null;
  page.entries.forEach((entry, index) => {
    const item = entry.item as { type: string; [key: string]: unknown };
    const id = `${page.epoch}:${base === undefined ? `i${index}` : base + index}`;
    const at = entry.timestamp ?? null;
    if (item.type === "assistant_message") {
      if (merging) merging.text += str(item.text);
      else {
        merging = {
          id,
          at,
          kind: "assistant",
          text: str(item.text),
          toolName: null,
          toolStatus: null,
        };
        items.push(merging);
      }
      return;
    }
    merging = null;
    if (item.type === "user_message")
      items.push({
        id,
        at,
        kind: "user",
        text: cap(str(item.text), MESSAGE_CAP),
        toolName: null,
        toolStatus: null,
      });
    else if (item.type === "tool_call")
      items.push({
        id,
        at,
        kind: "tool",
        text: toolText(item as { detail?: ToolDetail; error?: unknown }),
        toolName: str(item.name) || null,
        toolStatus: str(item.status) || null,
      });
    else if (item.type === "reasoning")
      items.push({
        id,
        at,
        kind: "thought",
        text: cap(str(item.text)),
        toolName: null,
        toolStatus: null,
      });
    else {
      let text = str(item.text) || str(item.message);
      if (!text && item.type === "todo" && Array.isArray(item.items))
        text = (item.items as Array<{ text?: unknown; completed?: unknown }>)
          .map((todo) => `${todo.completed ? "[x]" : "[ ]"} ${str(todo.text)}`)
          .join("\n");
      if (text)
        items.push({
          id,
          at,
          kind: "system",
          text,
          toolName: null,
          toolStatus: null,
        });
    }
  });
  for (const item of items)
    if (item.kind === "assistant") item.text = cap(item.text, MESSAGE_CAP);

  const agent = source.agents.find((candidate) => candidate.id === agentId);
  let taskId: string | null = null;
  for (const [id, attempts] of Object.entries(data.assistant?.attempts ?? {}))
    if (attempts.some((attempt) => attempt.agentId === agentId)) {
      taskId = id;
      break;
    }
  if (taskId === null)
    for (const [id, run] of Object.entries(data.orchestrations ?? {}))
      if (run.agentId === agentId) {
        taskId = id;
        break;
      }
  const task =
    taskId === null
      ? undefined
      : data.tasks.find((candidate) => candidate.id === taskId);
  if (!task) taskId = null;
  const log =
    taskId === null
      ? []
      : Object.values(data.orchestratorLogs ?? {})
          .flat()
          .filter((entry) => entry.taskId === taskId)
          .sort((left, right) => time(right.at) - time(left.at))
          .slice(0, 50)
          .map(({ at, level, text }) => ({ at, level, text }));
  return {
    agentId,
    title: agent?.title ?? null,
    status: agent ? agent.activity : "gone",
    items,
    hasOlder: page.hasOlder,
    cursor: page.startCursor,
    taskId,
    report:
      taskId === null
        ? null
        : (data.assistant?.deliveries?.[taskId]?.report ?? null),
    attempts: taskId === null ? [] : taskAttempts(data, taskId),
    log,
  };
}
