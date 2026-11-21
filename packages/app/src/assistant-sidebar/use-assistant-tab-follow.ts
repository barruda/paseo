// CUSTOM(pm-sidebar): the Project Manager tab lives in one workspace's Explorer. When the locked
// right sidebar moves to another workspace (a task of another workspace, another Desk) while it
// shows the Project Manager, the tab moves along instead of staying behind in the old Explorer.
import { useEffect, useRef } from "react";
import { shouldFollowAssistantTab } from "./model";
import { explorerShowsAssistant, followAssistantTab } from "./open";

export function useAssistantTabFollow(input: {
  workspaceKey: string | null;
  /** The Desk's right sidebar is locked and open. */
  lockedOpen: boolean;
}): void {
  const { workspaceKey, lockedOpen } = input;
  const previous = useRef(workspaceKey);
  useEffect(() => {
    const previousWorkspaceKey = previous.current;
    previous.current = workspaceKey;
    const follow = shouldFollowAssistantTab({
      previousWorkspaceKey,
      workspaceKey,
      lockedOpen,
      previousShowsAssistant: previousWorkspaceKey
        ? explorerShowsAssistant(previousWorkspaceKey)
        : false,
    });
    if (follow && workspaceKey) followAssistantTab(workspaceKey);
  }, [lockedOpen, workspaceKey]);
}
