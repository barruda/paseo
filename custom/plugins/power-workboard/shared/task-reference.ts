// CUSTOM(task-numbers): a ticket's short number (`#42` or `42`) is the reference people use in
// conversation; the UUID stays the stable identity.
export function parseTaskNumber(reference: string): number | null {
  const match = /^#?(\d+)$/.exec(reference.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** A task by UUID or by its short number, as the board tools accept both. */
export function resolveTaskReference<T extends { id: string; number: number }>(
  tasks: readonly T[],
  reference: string,
): T | undefined {
  const wanted = reference.trim();
  const byId = tasks.find((task) => task.id === wanted);
  if (byId) return byId;
  const number = parseTaskNumber(wanted);
  return number === null
    ? undefined
    : tasks.find((task) => task.number === number);
}

/** The label shown in cards, panels and tool output; empty for a task saved before numbers. */
export function taskNumberLabel(number: number): string {
  return number > 0 ? `#${number}` : "";
}
