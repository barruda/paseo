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

/** Other tab sets a tab can move to; the tab context menu shows a "Move to" submenu. */
export interface WorkspaceTabMoveMenu {
  targets: readonly { id: string; label: string }[];
  move(tabId: string, targetId: string): void;
}

const WorkspaceTabMoveContext = createContext<WorkspaceTabMoveMenu | null>(null);

export const WorkspaceTabMoveProvider = WorkspaceTabMoveContext.Provider;

export function useWorkspaceTabMoveMenu(): WorkspaceTabMoveMenu | null {
  return useContext(WorkspaceTabMoveContext);
}
