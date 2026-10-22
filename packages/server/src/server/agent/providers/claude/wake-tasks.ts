// CUSTOM(monitor-quiet-finish): Claude Code background tasks that wake the agent back up.
//
// When a turn ends while one of these runs, the agent is waiting on it, not done: a Monitor
// streams each event back as a new turn, and a background subagent or workflow reports back when
// it settles. Plain background shells are left out because a dev server never ends, and the
// "finished" notification would never come.

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
