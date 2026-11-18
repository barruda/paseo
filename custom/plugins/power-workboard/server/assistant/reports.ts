// CUSTOM(assistant-reports): the Projects Assistant's report entries (`board_report`), one JSON
// object per line in `plugin-data/power-workboard/reports/YYYY-MM-DD.jsonl` with the history's
// retention, and the Projects Reports views: the tickets with actions and one ticket's timeline,
// where the history the server writes by itself is merged with the assistant's entries.
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { Delivery, HistoryEvent } from "../../shared/assistant";
import {
  REPORT_REPLY_MAX,
  assistantReportSchema,
  type AssistantReport,
  type ReportColumn,
  type ReportEvent,
  type ReportOrchestrator,
  type ReportTask,
  type ReportTimeline,
  type ReportTimelineItem,
} from "../../shared/assistant-reports";
import { groupColorKey, orderedGroups } from "../../shared/model";
import { DayJsonlStore } from "./history";
import { parseReport } from "./report";
import type { ViewSource } from "./views";

export type ReportInput = Omit<AssistantReport, "id" | "at"> & { at?: string };

/** `<PASEO_HOME>/plugin-data/power-workboard/reports`, next to the history folder. */
export function defaultReportsDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  const home = raw.startsWith("~")
    ? path.join(os.homedir(), raw.slice(1))
    : raw;
  return path.join(
    path.resolve(home),
    "plugin-data",
    "power-workboard",
    "reports",
  );
}

export class ReportStore extends DayJsonlStore<AssistantReport> {
  constructor(
    directory: string,
    options: { now?: () => Date; retentionDays?: number } = {},
  ) {
    super(directory, assistantReportSchema, options);
  }

  /** Assigns `id` and `at` (unless given), writes one line, returns the stored entry. */
  append(entry: ReportInput): Promise<AssistantReport> {
    return this.write({
      ...entry,
      id: randomUUID(),
      at: entry.at ?? this.now().toISOString(),
    });
  }
}

const cap = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

/**
 * The orchestrator part of an entry. The agent's `<report>` block is read out of `reply` with the
 * delivery's parser, so the page shows it as a report and the reply without it.
 */
export function orchestratorPart(input: {
  agentId: string;
  prompt?: string | null;
  reply?: string | null;
}): ReportOrchestrator {
  const parsed = input.reply ? parseReport(input.reply) : null;
  return {
    agentId: input.agentId,
    prompt: input.prompt ? cap(input.prompt, REPORT_REPLY_MAX) : null,
    reply: parsed?.text ? cap(parsed.text, REPORT_REPLY_MAX) : null,
    report: parsed?.report ?? null,
  };
}

/**
 * An automatic event this long before an assistant entry belongs to that entry's iteration (the
 * entry reports on it); one this long after belongs to the entry before it (its consequence, such
 * as the merge after a merge-now without wait).
 */
export const ATTACH_BEFORE_MS = 15 * 60_000;
export const ATTACH_AFTER_MS = 2 * 60_000;

/** Kinds whose `agentId` is the task's agent (told-assistant's is the chat's). */
const AGENT_KINDS: ReadonlySet<HistoryEvent["kind"]> = new Set([
  "task-started",
  "task-continued",
  "fix-requested",
  "report",
  "needs-you",
  "failed",
  "observed",
]);

const time = (iso: string) => {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
};
const oldestFirst = <T extends { at: string; id: string }>(a: T, b: T) =>
  time(a.at) - time(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const toEvent = (event: HistoryEvent): ReportEvent => ({
  id: event.id,
  at: event.at,
  kind: event.kind,
  text: event.text,
  detail: event.detail,
  agentId: event.agentId,
});

/** A history event as an item of its own; the agent's part moves into `orchestrator`. */
function autoItem(
  event: HistoryEvent,
  delivery: Delivery | undefined,
): ReportTimelineItem {
  let detail = event.detail;
  let orchestrator: ReportOrchestrator | null = null;
  if (event.agentId && AGENT_KINDS.has(event.kind)) {
    orchestrator = {
      agentId: event.agentId,
      prompt: null,
      reply: null,
      report: null,
    };
    if (event.kind === "report") {
      orchestrator.reply = detail;
      orchestrator.report =
        delivery && delivery.attempt === event.attempt ? delivery.report : null;
      detail = null;
    } else if (
      event.kind === "task-continued" ||
      event.kind === "fix-requested"
    ) {
      orchestrator.prompt = detail;
      detail = null;
    }
  }
  return {
    source: "auto",
    id: event.id,
    at: event.at,
    kind: event.kind,
    summary: event.text,
    detail,
    orchestrator,
  };
}

/**
 * One ticket's items, oldest first. Each assistant entry is an item; each history event joins the
 * entry right before it (within ATTACH_AFTER_MS), else the entry right after it (within
 * ATTACH_BEFORE_MS), else stands as an automatic item.
 */
export function mergeTimeline(
  events: readonly HistoryEvent[],
  reports: readonly AssistantReport[],
  delivery?: Delivery,
): ReportTimelineItem[] {
  const entries = [...reports].sort(oldestFirst);
  const folded = new Map<string, ReportEvent[]>(entries.map((r) => [r.id, []]));
  const items: ReportTimelineItem[] = [];
  for (const event of [...events].sort(oldestFirst)) {
    const at = time(event.at);
    let previous: AssistantReport | undefined;
    let next: AssistantReport | undefined;
    for (const entry of entries) {
      if (time(entry.at) <= at) previous = entry;
      else {
        next = entry;
        break;
      }
    }
    const owner =
      previous && at - time(previous.at) <= ATTACH_AFTER_MS
        ? previous
        : next && time(next.at) - at <= ATTACH_BEFORE_MS
          ? next
          : undefined;
    if (owner) folded.get(owner.id)!.push(toEvent(event));
    else items.push(autoItem(event, delivery));
  }
  for (const entry of entries)
    items.push({
      source: "assistant",
      id: entry.id,
      at: entry.at,
      kind: entry.kind,
      summary: entry.summary,
      detail: entry.detail,
      decisions: entry.decisions,
      orchestrator: entry.orchestrator,
      quickMessageId: entry.quickMessageId,
      events: folded.get(entry.id)!,
    });
  return items.sort(oldestFirst);
}

interface TaskInfo {
  title: string;
  projectId: string | null;
  projectName: string;
  column: string | null;
  columnId: string | null;
  description: string;
}

/** The task as the board shows it now; from its newest record once it left the board. */
function taskInfo(
  source: ViewSource,
  taskId: string,
  records: readonly {
    taskTitle: string;
    projectId: string | null;
    projectName: string;
  }[],
): TaskInfo {
  const task = source.data.tasks.find((t) => t.id === taskId);
  const card = source.board.cards.find((c) => c.id === taskId);
  const group = card
    ? source.board.settings.groups.find((g) => g.id === card.stage)
    : undefined;
  const newest = records.at(-1);
  const projectId = card?.projectId ?? task?.projectId ?? newest?.projectId;
  const projectName =
    card?.projectName ||
    task?.projectName ||
    source.board.projects.find((p) => p.id === projectId)?.name ||
    newest?.projectName ||
    "";
  return {
    title: card?.title ?? task?.title ?? newest?.taskTitle ?? "",
    projectId: projectId ?? null,
    projectName,
    column: card ? (group ? (group.name ?? group.label) : card.stage) : null,
    columnId: card ? card.stage : null,
    description: task?.description ?? "",
  };
}

function byTask<T extends { taskId: string }>(values: readonly T[]) {
  const map = new Map<string, T[]>();
  for (const value of values) {
    const list = map.get(value.taskId) ?? [];
    list.push(value);
    map.set(value.taskId, list);
  }
  return map;
}

/** Records oldest first, as they come from the stores. */
function recordsOf(
  events: readonly HistoryEvent[],
  reports: readonly AssistantReport[],
) {
  return [...events, ...reports].sort(oldestFirst);
}

/** The board's columns in board order, for the status filter. */
export function buildReportColumns(source: ViewSource): ReportColumn[] {
  return orderedGroups(source.board.settings).map((group) => ({
    id: group.id,
    name: group.name ?? group.label,
    kind: group.kind,
    color: groupColorKey(group),
  }));
}

/** Every ticket with at least one item, newest action first. */
export function buildReportTasks(
  source: ViewSource,
  events: readonly HistoryEvent[],
  reports: readonly AssistantReport[],
): ReportTask[] {
  const eventsByTask = byTask(events);
  const reportsByTask = byTask(reports);
  const ids = new Set([...eventsByTask.keys(), ...reportsByTask.keys()]);
  const tasks: ReportTask[] = [];
  for (const taskId of ids) {
    const taskEvents = eventsByTask.get(taskId) ?? [];
    const taskReports = reportsByTask.get(taskId) ?? [];
    const items = mergeTimeline(
      taskEvents,
      taskReports,
      source.data.assistant.deliveries[taskId],
    );
    const last = items.at(-1);
    if (!last) continue;
    const info = taskInfo(source, taskId, recordsOf(taskEvents, taskReports));
    tasks.push({
      taskId,
      title: info.title,
      projectId: info.projectId,
      projectName: info.projectName,
      column: info.column,
      columnId: info.columnId,
      lastAt: last.at,
      lastSummary: last.summary,
      items: items.length,
      assistantItems: taskReports.length,
    });
  }
  return tasks.sort(
    (a, b) =>
      time(b.lastAt) - time(a.lastAt) ||
      (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0),
  );
}

/** One ticket's header and timeline; null when nothing was recorded for it. */
export function buildReportTimeline(
  source: ViewSource,
  taskId: string,
  events: readonly HistoryEvent[],
  reports: readonly AssistantReport[],
): ReportTimeline | null {
  const taskEvents = events.filter((e) => e.taskId === taskId);
  const taskReports = reports.filter((r) => r.taskId === taskId);
  const items = mergeTimeline(
    taskEvents,
    taskReports,
    source.data.assistant.deliveries[taskId],
  );
  if (!items.length) return null;
  const { columnId: _columnId, ...info } = taskInfo(
    source,
    taskId,
    recordsOf(taskEvents, taskReports),
  );
  return { task: { taskId, ...info }, items };
}
