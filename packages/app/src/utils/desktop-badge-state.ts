import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
// CUSTOM(hidden-board-agents)
import { workspaceStatusesWithoutBoardAgents } from "@/board-agents/badges";
import { memoizeOnSessionMaps } from "./memoize-on-session-maps";

export type DesktopBadgeWorkspaceStatus = WorkspaceDescriptor["status"];

interface WorkspaceStatusSession {
  workspaces: ReadonlyMap<string, WorkspaceDescriptor>;
  // CUSTOM(hidden-board-agents): the agents tell which workspaces hold only board agents.
  agents?: ReadonlyMap<string, Agent>;
  agentDetails?: ReadonlyMap<string, Agent>;
}

interface WorkspaceStatusSource {
  sessions: Record<string, WorkspaceStatusSession | undefined>;
}

export function isWorkspaceActionableForDesktopBadge(status: DesktopBadgeWorkspaceStatus): boolean {
  return status === "attention" || status === "needs_input" || status === "failed";
}

/**
 * The macOS dock badge only needs a count, so count here instead of materialising every
 * workspace status and comparing the whole list on every store write.
 */
export interface DockBadgeOptions {
  /** Count background workspaces too, as the sidebar shows them while Show background is on. */
  showBackground?: boolean;
}

export function selectMacDockBadgeCount(
  state: WorkspaceStatusSource,
  options: DockBadgeOptions = {},
): number | undefined {
  let actionableCount = 0;
  for (const session of Object.values(state.sessions)) {
    if (!session) continue;
    // CUSTOM(hidden-board-agents): workspaces with only board agents don't count, and a shared
    // workspace's status is derived again from its other agents.
    // A hidden background workspace would leave the badge pointing at nothing in the sidebar.
    const statuses = workspaceStatusesWithoutBoardAgents(
      session,
      (workspace) => !workspace.background || options.showBackground === true,
    );
    for (const status of statuses) {
      if (isWorkspaceActionableForDesktopBadge(status)) actionableCount += 1;
    }
  }
  return actionableCount > 0 ? actionableCount : undefined;
}

/** A session-store selector for the dock badge count that recounts only when a workspace map changes. */
export function createMacDockBadgeCountSelector(
  options: DockBadgeOptions = {},
): (state: WorkspaceStatusSource) => number | undefined {
  return memoizeOnSessionMaps<WorkspaceStatusSession, WorkspaceStatusSource, number | undefined>(
    (session) => [session.workspaces, session.agents, session.agentDetails],
    (state) => selectMacDockBadgeCount(state, options),
  );
}
