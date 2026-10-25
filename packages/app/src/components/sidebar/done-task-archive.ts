// CUSTOM(done-task-archive): the Workboard plugins mark finished tasks with these workspace labels
// (`task:done` from the original Workboard, `pwb:done` from Power Workboard). Their Done columns
// can be renamed to another label, but the defaults are what we use.
const DONE_TASK_LABELS = new Set(["task:done", "pwb:done"]);

export function isDoneTaskWorkspace(labels: readonly string[] | undefined): boolean {
  return labels?.some((label) => DONE_TASK_LABELS.has(label.trim().toLowerCase())) ?? false;
}
