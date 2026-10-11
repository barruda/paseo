// CUSTOM(done-task-archive): the Workboard plugin marks finished tasks with this workspace label.
// Its Done column can be renamed to another label, but the default is what we use.
const DONE_TASK_LABEL = "task:done";

export function isDoneTaskWorkspace(labels: readonly string[] | undefined): boolean {
  return labels?.some((label) => label.trim().toLowerCase() === DONE_TASK_LABEL) ?? false;
}
