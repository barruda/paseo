// CUSTOM(monitor-quiet-finish): Claude Code background tasks that wake the agent back up.
//
// When a turn ends while one of these runs, the agent is waiting on it, not done: a Monitor
// streams each event back as a new turn, and a background subagent or workflow reports back when
// it settles. Plain background shells are left out because a dev server never ends, and the
// "finished" notification would never come.

import type { AgentBackgroundTask } from "../../agent-sdk-types.js";

interface ClaudeBackgroundTask {
  task_type?: unknown;
  shell_kind?: unknown;
  ambient?: unknown;
}

const WAKE_TASK_TYPES = new Set(["monitor_mcp", "monitor_ws", "local_agent", "local_workflow"]);

export function isClaudeWakeTask(task: ClaudeBackgroundTask): boolean {
  if (task.ambient === true) {
    return false;
  }
  if (task.task_type === "local_bash") {
    return task.shell_kind === "monitor";
  }
  return typeof task.task_type === "string" && WAKE_TASK_TYPES.has(task.task_type);
}

/** Reads a `background_tasks_changed` system message: how many live tasks wake the agent. */
export function countClaudeWakeTasks(message: unknown): number {
  const tasks = (message as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(tasks)) {
    return 0;
  }
  return tasks.filter(
    (task): task is ClaudeBackgroundTask =>
      typeof task === "object" && task !== null && isClaudeWakeTask(task),
  ).length;
}

// CUSTOM(background-tools): the live background tools the user can see, as a list.
//
// Subagents and workflows are left out: they have their own track. Everything else that runs in
// the background (a Bash with run_in_background, a Monitor) is a tool.

export function readClaudeToolCommand(input: unknown): string | undefined {
  const command = (input as { command?: unknown } | null)?.command;
  return typeof command === "string" && command.trim().length > 0 ? command : undefined;
}

/** Maps a `background_tasks_changed` message; `commands` is task id to command line. */
export function mapClaudeBackgroundTools(
  message: unknown,
  commands: ReadonlyMap<string, string>,
): AgentBackgroundTask[] {
  const tasks = (message as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(tasks)) {
    return [];
  }
  const result: AgentBackgroundTask[] = [];
  for (const task of tasks) {
    if (typeof task !== "object" || task === null) continue;
    const { task_id, task_type, shell_kind, ambient, description } = task as Record<
      string,
      unknown
    >;
    if (typeof task_id !== "string" || ambient === true) continue;
    if (task_type === "local_agent" || task_type === "local_workflow") continue;
    let kind: AgentBackgroundTask["kind"] = "other";
    if (task_type === "local_bash") {
      kind = shell_kind === "monitor" ? "monitor" : "shell";
    } else if (typeof task_type === "string" && task_type.startsWith("monitor_")) {
      kind = "monitor";
    }
    const command = commands.get(task_id);
    result.push({
      id: task_id,
      kind,
      description: typeof description === "string" ? description : "",
      ...(command ? { command } : {}),
    });
  }
  return result;
}
