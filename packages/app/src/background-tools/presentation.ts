// CUSTOM(background-tools): wording and copy text for the "N tools" chip. English only, like the
// other custom pills.
import type { AgentBackgroundTaskPayload } from "@getpaseo/protocol/messages";

export function formatBackgroundToolCount(count: number): string {
  return count === 1 ? "1 tool" : `${count} tools`;
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

export function hasBackgroundTools(tasks: readonly AgentBackgroundTaskPayload[] | undefined) {
  return (tasks?.length ?? 0) > 0;
}
