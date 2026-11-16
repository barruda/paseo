// CUSTOM(background-tools): wording and copy text for the "N tools" chip. English only, like the
// other custom pills.
import type { AgentBackgroundTaskPayload } from "@getpaseo/protocol/messages";

export interface BackgroundToolsPillSegment {
  bucket: "running" | null;
  text: string;
}

function countLabel(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`;
}

/**
 * Monitors are work (they wake the agent, so they spin). Shells and the rest are only listed: a
 * dev server never ends, so it gets a plain dot. Empty groups are left out.
 */
export function buildBackgroundToolsSegments(
  tasks: readonly AgentBackgroundTaskPayload[],
): BackgroundToolsPillSegment[] {
  const monitors = tasks.filter((task) => task.kind === "monitor").length;
  const others = tasks.length - monitors;
  const segments: BackgroundToolsPillSegment[] = [];
  if (monitors > 0) segments.push({ bucket: "running", text: countLabel(monitors, "monitor") });
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
