// CUSTOM(projects-assistant): strings of the Projects Dashboard.
import type {
  DeliveryStage,
  HistoryEventKind,
  NeedsYouReason,
} from "../../shared/assistant";
// CUSTOM(resource-pools)
import { FIX_WAIT_LIMIT_MS } from "../../shared/assistant";
import type { OrchestratorHold } from "../../shared/hold";
import type { PageLocale } from "../paseo-language";
import { formatHold } from "../hold-format";

export const REASON_LABELS: Record<NeedsYouReason, string> = {
  review: "Project Manager reviewing",
  notify: "Ready for review",
  observed: "Observe mode: would deliver",
  "no-report": "No report from the agent",
  blocked: "Agent is blocked",
  "needs-input": "Agent needs your input",
  failed: "Task failed",
  "agent-error": "Agent error",
  "verify-failed": "Check failed",
  "merge-conflict": "Merge conflict",
  "dirty-checkout": "Checkout has uncommitted changes",
  "merge-error": "Merge failed",
  "pr-error": "Could not prepare the PR",
  "dependency-files": "Dependencies would be committed",
  stalled: "Stalled", // CUSTOM(task-checkpoints)
  "fix-waiting": "Fix waiting for a slot", // CUSTOM(resource-pools)
  "usage-limit": "Usage limit hit again", // CUSTOM(usage-limit)
  permission: "Waiting for a permission", // CUSTOM(unattended-automation)
};

export const KIND_LABELS: Record<HistoryEventKind, string> = {
  "task-created": "Created", // CUSTOM(assistant-reports)
  "task-moved": "Moved", // CUSTOM(assistant-reports)
  "task-started": "Started",
  "task-continued": "Continued",
  "folder-dirty": "Folder dirty at start", // CUSTOM(orchestrator-in-place)
  report: "Report",
  checkpoint: "Checkpoint", // CUSTOM(task-checkpoints)
  "usage-limit": "Usage limit", // CUSTOM(usage-limit)
  "verify-passed": "Check passed",
  "verify-failed": "Check failed",
  "fix-requested": "Fix requested",
  "waiting-clean": "Waiting for a clean checkout",
  committed: "Committed",
  merged: "Merged",
  "pr-prepared": "PR prepared",
  "needs-you": "Needs you",
  "told-assistant": "Told the Project Manager",
  "chat-compacted": "Chat compacted", // CUSTOM(assistant-compact)
  "chat-compact-failed": "Chat compaction failed", // CUSTOM(assistant-compact)
  observed: "Observed",
  failed: "Failed",
  done: "Done",
  dismissed: "Dismissed",
};

/**
 * CUSTOM(resource-pools): why a delivery's fix waits for a pool slot, in English and Brazilian
 * Portuguese like the Reports page. Chinese falls back to English.
 */
const FIX_WAIT_EN = {
  holdPool: "Fix waiting: pool “{pool}” is full ({running}/{max})",
  holdRam: "Fix waiting for RAM: {free}% free, pool “{pool}” needs {min}%",
  holdSettle:
    "Fix waiting for RAM to settle: pool “{pool}” just started an agent; next start at {time}",
  holdFolder: "Fix waiting: “{task}” is not delivered yet in {directory}",
  waitedTooLong: (minutes: number) =>
    `The fix has waited over ${minutes} minutes for a free slot. It still goes to the agent when one frees; merge, continue or dismiss replaces it.`,
};
const FIX_WAIT_PT: typeof FIX_WAIT_EN = {
  holdPool: "Correção esperando: o pool “{pool}” está cheio ({running}/{max})",
  holdRam: "Correção esperando RAM: {free}% livre, o pool “{pool}” pede {min}%",
  holdSettle:
    "Correção esperando a RAM assentar: o pool “{pool}” acabou de iniciar um agente; próximo início às {time}",
  holdFolder:
    "Correção esperando: “{task}” ainda não foi entregue em {directory}",
  waitedTooLong: (minutes: number) =>
    `A correção espera uma vaga há mais de ${minutes} minutos. Ela ainda vai para o agente quando uma vaga abrir; mesclar, continuar ou dispensar a substitui.`,
};
/** CUSTOM(resource-pools): why a waiting fix waits, for the Running row. */
export function fixHoldText(
  hold: OrchestratorHold,
  locale: PageLocale,
): string {
  return formatHold(
    hold,
    locale === "pt" ? FIX_WAIT_PT : FIX_WAIT_EN,
    locale === "pt" ? "pt-BR" : "en",
  );
}
/** CUSTOM(resource-pools): the Needs you card of a fix that waited FIX_WAIT_LIMIT_MS. */
export function fixWaitedText(
  hold: OrchestratorHold | null | undefined,
  locale: PageLocale,
): string {
  const text = (locale === "pt" ? FIX_WAIT_PT : FIX_WAIT_EN).waitedTooLong(
    FIX_WAIT_LIMIT_MS / 60_000,
  );
  return hold ? `${text}\n${fixHoldText(hold, locale)}` : text;
}

export const STAGE_LABELS: Record<
  "running" | "waiting" | DeliveryStage,
  string
> = {
  running: "Working",
  waiting: "Waiting", // CUSTOM(task-checkpoints)
  reported: "Reported",
  verifying: "Checking",
  fixing: "Fixing",
  committing: "Committing",
  merging: "Merging",
  "preparing-pr": "Preparing PR",
  delivered: "Delivered",
  "needs-you": "Needs you",
  dismissed: "Dismissed",
};

export const dashboardStrings = {
  title: "Projects Dashboard",
  statusOn: "Project Manager is on",
  statusOff: "Project Manager is off",
  offHint: "Turn it on in Settings → Bruno's Customizations → Project Manager",
  needsYou: "Needs you",
  needsYouEmpty: "Nothing needs you",
  // CUSTOM(assistant-wake)
  notifyIn: (seconds: number) => `Notifying the PM in ${seconds} s`,
  notifyNow: "Notifying the PM…",
  withPm: (time: string) => `With the PM since ${time}`,
  running: "Running now",
  runningEmpty: "Nothing is running",
  queued: (n: number) => `${n} queued`,
  attempt: (n: number) => `attempt ${n}`,
  // CUSTOM(task-checkpoints)
  checkpointWord: "checkpoint",
  waitingTitle: "Waiting",
  resumes: (time: string) => `resumes ${time}`,
  // CUSTOM(usage-limit)
  limitPaused: (time: string | null) =>
    time
      ? `paused by the usage limit until ${time}`
      : "paused by the usage limit",
  nextPass: "next pass",
  numbers: "Numbers",
  period: (d: number) => `${d} days`,
  charts: "Charts",
  perDay: "Per day",
  perProject: "Per project",
  perOrchestrator: "Per orchestrator",
  legendMerged: "Merged",
  legendOtherDone: "Done (other)",
  legendFailed: "Failed",
  legendNeedsYou: "Needs you",
  legendDone: "Done",
  noData: "No data yet",
  history: "History",
  historyEmpty: "No events",
  loadMore: "Load more",
  loading: "Loading…",
  loadError: "Could not load",
  retry: "Retry",
  filterProject: "Project",
  filterOrchestrator: "Orchestrator",
  filterKind: "Event",
  filterAll: "All",
  mergeNow: "Merge now",
  confirmMerge: "Confirm merge",
  cancel: "Cancel",
  continue: "Continue",
  sendFeedback: "Send",
  feedbackPlaceholder: "What should the agent change?",
  markDone: "Mark done",
  dismiss: "Dismiss",
  openConversation: "Open conversation",
  openReport: "Open report",
  showMore: "Show more",
  showLess: "Show less",
  question: "Question",
  summary: "Summary",
  manual: "Started by hand",
  tiles: {
    doneToday: "Done today",
    doneInPeriod: "Done in period",
    mergedInPeriod: "Merged in period",
    firstTryRate: "First try",
    averageAttempts: "Avg attempts",
    averageDuration: "Avg duration",
    needsYou: "Needs you",
    running: "Running",
    queued: "Queued",
  },
  ago: {
    now: "just now",
    minutes: (n: number) => `${n} min ago`,
    hours: (n: number) => `${n} h ago`,
    days: (n: number) => `${n} d ago`,
  },
} as const;
