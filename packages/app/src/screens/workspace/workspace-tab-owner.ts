// CUSTOM(desks): lets one split layout hold tabs from many workspaces. The workspace screen
// renders no provider, so every tab belongs to the screen's own workspace as before.
import { createContext, useContext } from "react";

export interface WorkspaceTabOwner {
  serverId: string;
  workspaceId: string;
  /** A Desk preview tab: replaced by the next task the user previews. */
  preview?: boolean;
}

export type WorkspaceTabOwnerResolver = (tabId: string) => WorkspaceTabOwner | null;

const WorkspaceTabOwnerContext = createContext<WorkspaceTabOwnerResolver | null>(null);

export const WorkspaceTabOwnerProvider = WorkspaceTabOwnerContext.Provider;

export function useWorkspaceTabOwnerResolver(): WorkspaceTabOwnerResolver | null {
  return useContext(WorkspaceTabOwnerContext);
}

export function useWorkspaceTabOwner(
  tabId: string,
  fallback: { serverId: string; workspaceId: string },
): WorkspaceTabOwner {
  return useContext(WorkspaceTabOwnerContext)?.(tabId) ?? fallback;
}
