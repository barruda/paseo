// CUSTOM(background-tools): wording and copy text for the "N tools" chip. English only, like the
// other custom pills.
import type { AgentBackgroundTaskPayload } from "@getpaseo/protocol/messages";

export interface BackgroundToolsPillSegment {
  // CUSTOM(background-waiting): "waiting" is the violet ring for shells that poll for something.
  bucket: "running" | "waiting" | null;
  text: string;
}

function countLabel(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`;
}

// CUSTOM(background-waiting): Claude Code re-invokes the agent when a background shell exits, so
// a shell that ends on its own (a poll loop, a sleep, a CI watch, a build writing a log, a
// `tail -f log | grep` watching that build) means the agent is not done. A dev server never exits,
// so it must not count. The app only sees the command line, hence the heuristic.
const WAIT_COMMAND_PATTERNS: readonly RegExp[] = [
  /\buntil\b[\s\S]*\bdo\b/,
  /\bwhile\b[\s\S]*\bsleep\b/,
  /(?:^|[;&|]\s*)sleep\s+\d/,
  /\btail\s+(?:\S+\s+)*--pid\b/,
  /\binotifywait\b/,
  /\bgh\s+run\s+watch\b/,
  /\bgh\s+pr\s+checks\b[^;&|]*--watch\b/,
  /(?:^|[;&|(]\s*)wait(?:\s|;|$)/,
];
const WAIT_DESCRIPTION_PATTERN = /^(?:wait|waiting|aguard|esper)/i;
const SERVICE_COMMAND_PATTERNS: readonly RegExp[] = [
  /\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:dev|start|serve)\b/,
  /\bnpm\s+start\b/,
  /\bdev-daemon\b/,
  /\bserve\b/,
  /\bhttp\.server\b/,
  /\bvite\b(?!\.|\s+build\b)/,
  /\bexpo\s+start\b/,
  /\btail\s+(?!.*--pid)(?:\S+\s+)*-[fF]\b/,
  /\bdocker\s+compose\s+up\b(?![^;&|]*\s-d\b)/,
];
const GH_WATCH_PATTERN = /\bgh\s+(?:run\s+watch|pr\s+checks\b[^;&|]*--watch)\b/;
const WATCH_FLAG_PATTERN = /--watch\b/;
// A log watcher: `tail -f build.log | grep --line-buffered 'EXIT|FAIL'`. It ends when the agent
// kills it after the job it watches. Without the filter, `tail -f` stays a service.
const LOG_WATCH_PATTERN = /\btail\s+[^|;&]*?(?:-[fF]|--follow)\b[^|;&]*\|\s*(?:e?grep|rg|awk)\b/;
const LOG_WATCH_FILTER_PATTERN = /--line-buffered|\b(?:exit|fail\w*|error|done|passed)\b/i;
// A finite job: it records its exit code, or it builds/tests/installs into a log file.
const EXIT_CODE_PATTERN = /\b(?:echo|printf)\b[^;&|]*\$\?/;
const JOB_COMMAND_PATTERN =
  /\b(?:build|test|tests|install|update|deploy|compile|verify|typecheck|lint|migrate|release|publish|vitest|jest|pytest|tsc|make|cargo|gradlew?|xcodebuild)\b/i;
const REDIRECT_TARGET_PATTERN = /(?:&>>?|>>?|\|\s*tee\s+(?:-a\s+)?)\s*([^\s&|;<>]+)/g;
const JOB_DESCRIPTION_PATTERN =
  /\b(?:build|builds|building|install|installing|test|tests|testing|verify|verifying|commit|committing|merge|merging|deploy|deploying|compile|compiling|typecheck|lint|linting|release|publish|compilar|compilando|testar|testando|testes|instalar|instalando|verificar|buildar|buildando)\b/i;
const SERVICE_DESCRIPTION_PATTERN = /\b(?:server|servidor|daemon|serve|serving|watch\w*)\b/i;

function isLogWatcher(command: string): boolean {
  const match = LOG_WATCH_PATTERN.exec(command);
  if (!match) return false;
  return LOG_WATCH_FILTER_PATTERN.test(command.slice(match.index + match[0].length));
}

function writesToFile(command: string): boolean {
  for (const match of command.matchAll(REDIRECT_TARGET_PATTERN)) {
    if (match[1] !== "/dev/null") return true;
  }
  return false;
}

function isFiniteJob(command: string, description: string): boolean {
  if (EXIT_CODE_PATTERN.test(command)) return true;
  if (JOB_COMMAND_PATTERN.test(command) && writesToFile(command)) return true;
  return (
    JOB_DESCRIPTION_PATTERN.test(description) && !SERVICE_DESCRIPTION_PATTERN.test(description)
  );
}

export function isWaitingBackgroundTool(task: AgentBackgroundTaskPayload): boolean {
  if (task.kind !== "shell") return false;
  const command = task.command ?? "";
  const description = task.description.trim();
  const logWatcher = isLogWatcher(command);
  // The watcher's own `tail -f` is not a service; anything else chained to it still vetoes.
  const rest = logWatcher ? command.replace(LOG_WATCH_PATTERN, " ") : command;
  if (SERVICE_COMMAND_PATTERNS.some((pattern) => pattern.test(rest))) return false;
  if (WATCH_FLAG_PATTERN.test(command) && !GH_WATCH_PATTERN.test(command)) return false;
  return (
    logWatcher ||
    WAIT_COMMAND_PATTERNS.some((pattern) => pattern.test(command)) ||
    WAIT_DESCRIPTION_PATTERN.test(description) ||
    isFiniteJob(command, description)
  );
}

export function hasWaitingBackgroundTools(
  tasks: readonly AgentBackgroundTaskPayload[] | undefined,
): boolean {
  return tasks?.some(isWaitingBackgroundTool) ?? false;
}

/**
 * Monitors are work (they wake the agent, so they spin). Waiting shells get the violet ring.
 * The other shells are only listed: a dev server never ends, so it gets a plain dot. Empty
 * groups are left out.
 */
export function buildBackgroundToolsSegments(
  tasks: readonly AgentBackgroundTaskPayload[],
): BackgroundToolsPillSegment[] {
  const monitors = tasks.filter((task) => task.kind === "monitor").length;
  const waiting = tasks.filter(isWaitingBackgroundTool).length;
  const others = tasks.length - monitors - waiting;
  const segments: BackgroundToolsPillSegment[] = [];
  if (monitors > 0) segments.push({ bucket: "running", text: countLabel(monitors, "monitor") });
  if (waiting > 0) segments.push({ bucket: "waiting", text: `${waiting} waiting` });
  if (others > 0) segments.push({ bucket: null, text: countLabel(others, "shell") });
  return segments;
}

export function backgroundToolKindLabel(kind: string): string {
  switch (kind) {
    case "shell":
      return "Shell";
    case "monitor":
      return "Monitor";
    default:
      return "Tool";
  }
}

/** What a click copies: the command line when known, else the description. */
export function backgroundToolCopyText(task: AgentBackgroundTaskPayload): string {
  const command = task.command?.trim();
  return command ? command : task.description;
}

/** Monitors wake the agent, shells do not: the same rule as the daemon's wake-tasks.ts. */
export function hasWakingBackgroundTools(
  tasks: readonly AgentBackgroundTaskPayload[] | undefined,
): boolean {
  return tasks?.some((task) => task.kind === "monitor") ?? false;
}

export function hasBackgroundTools(tasks: readonly AgentBackgroundTaskPayload[] | undefined) {
  return (tasks?.length ?? 0) > 0;
}

// CUSTOM(background-waiting): the agent ended its turn but a waiting shell will wake it again.
// Only a finished tab (done or unread) is lifted; needs_input, failed and running win.
export function withWaitingBackgroundTools<T extends string>(
  bucket: T | null,
  waiting: boolean,
): T | "waiting" | null {
  if (waiting && (bucket === "done" || bucket === "attention")) return "waiting";
  return bucket;
}

// CUSTOM(shell-row-loading): whether the tool call that started a background task still runs, so
// its timeline row keeps the loading shimmer after the call itself returned.
export function isBackgroundToolCallActive(
  tasks: readonly AgentBackgroundTaskPayload[] | undefined,
  callId: string | undefined,
): boolean {
  if (!callId || !tasks) return false;
  return tasks.some((task) => task.toolCallId === callId);
}
