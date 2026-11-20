// CUSTOM(assistant-reports): pure helpers of the Projects Reports page.
import type {
  ReportColumn,
  ReportTask,
  ReportTimelineItem,
} from "../../shared/assistant-reports";

export type Tone = "success" | "warning" | "danger" | "accent" | "muted";

/**
 * Case-insensitive match on title and project name; `projectId` null shows every project. A task
 * in one of `hiddenColumns` is left out; a task off the board (no column) always passes.
 */
export function filterReportTasks(
  tasks: ReportTask[],
  query: string,
  projectId: string | null,
  hiddenColumns: readonly string[] = [],
): ReportTask[] {
  const q = query.trim().toLowerCase();
  const hidden = new Set(hiddenColumns);
  return tasks.filter((task) => {
    if (task.columnId !== null && hidden.has(task.columnId)) return false;
    if (
      projectId !== null &&
      (task.projectId ?? task.projectName) !== projectId
    )
      return false;
    if (!q) return true;
    return (
      task.title.toLowerCase().includes(q) ||
      task.projectName.toLowerCase().includes(q)
    );
  });
}

/** The status filter's default: every column on except the Backlog (To do) ones. */
export function defaultHiddenColumns(
  columns: readonly ReportColumn[],
): string[] {
  return columns
    .filter((column) => column.kind === "todo")
    .map((column) => column.id);
}

/** `hidden` with `columnId` switched on or off. */
export function toggleHiddenColumn(
  hidden: readonly string[],
  columnId: string,
): string[] {
  return hidden.includes(columnId)
    ? hidden.filter((id) => id !== columnId)
    : [...hidden, columnId];
}

/** Distinct projects by name, for the filter chips. The id is the name when the project has none. */
export function reportProjects(
  tasks: ReportTask[],
): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const task of tasks) {
    const id = task.projectId ?? task.projectName;
    if (!seen.has(id)) seen.set(id, task.projectName);
  }
  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The first paragraph, cut to `max` characters with an ellipsis. */
export function descriptionExcerpt(
  text: string,
  max = 280,
): { excerpt: string; truncated: boolean } {
  const trimmed = text.trim();
  const paragraph = trimmed.split(/\n\s*\n/, 1)[0] ?? "";
  const cut = paragraph.length > max;
  const excerpt = cut ? `${paragraph.slice(0, max).trimEnd()}…` : paragraph;
  return { excerpt, truncated: cut || paragraph.length < trimmed.length };
}

const ENTRY_ICONS: Record<string, string> = {
  created: "Plus",
  started: "Play",
  moved: "ArrowRight",
  reviewed: "Eye",
  feedback: "MessageSquare",
  answered: "MessageCircleReply",
  fixed: "Wrench",
  merged: "GitMerge",
  escalated: "AlertTriangle",
  note: "StickyNote",
};

const EVENT_ICONS: Record<string, string> = {
  "task-created": "Plus",
  "task-moved": "ArrowRight",
  "task-started": "Play",
  "task-continued": "Play",
  "folder-dirty": "FolderOpen", // CUSTOM(orchestrator-in-place)
  report: "FileText",
  checkpoint: "Flag", // CUSTOM(task-checkpoints)
  "usage-limit": "Clock", // CUSTOM(usage-limit)
  "verify-passed": "CheckCircle2",
  "verify-failed": "XCircle",
  "fix-requested": "Wrench",
  "waiting-clean": "Clock",
  committed: "GitCommit",
  merged: "GitMerge",
  "pr-prepared": "GitPullRequest",
  "needs-you": "Bell",
  "told-assistant": "Bot",
  "chat-compacted": "RotateCcw", // CUSTOM(assistant-compact)
  "chat-compact-failed": "XCircle", // CUSTOM(assistant-compact)
  observed: "Eye",
  failed: "XCircle",
  done: "CircleCheck",
  dismissed: "Ban",
};

export function kindIcon(
  item: Pick<ReportTimelineItem, "source" | "kind">,
): string {
  const table = item.source === "assistant" ? ENTRY_ICONS : EVENT_ICONS;
  return table[item.kind] ?? "Bot";
}

export function kindTone(
  item: Pick<ReportTimelineItem, "source" | "kind">,
): Tone {
  const kind: string = item.kind;
  if (item.source === "assistant") {
    if (kind === "merged") return "success";
    if (kind === "escalated") return "warning";
    return "accent";
  }
  if (["merged", "done", "verify-passed"].includes(kind)) return "success";
  if (["needs-you", "escalated", "waiting-clean", "usage-limit"].includes(kind))
    return "warning";
  // CUSTOM(assistant-compact): chat-compact-failed
  if (["failed", "verify-failed", "chat-compact-failed"].includes(kind))
    return "danger";
  return "muted";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** HH:MM for today, otherwise DD/MM HH:MM, in local time. */
export function formatClock(iso: string, now: number): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const today = new Date(now);
  const same =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  return same ? time : `${pad(at.getDate())}/${pad(at.getMonth() + 1)} ${time}`;
}
