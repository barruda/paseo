// CUSTOM(task-pins): an agent tab's context menu pins or unpins its session in the Tasks sidebar.
import { useMemo } from "react";
import { useWorkspaceTabOwnerResolver } from "@/screens/workspace/workspace-tab-owner";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { taskKey } from "./model";
import { usePinnedTasksStore } from "./pinned-tasks-store";

export interface AgentTabPin {
  pinned: boolean;
  toggle(): void;
}

/** Undefined for tabs that are not agents. A Desk tab pins against its own host. */
export function useAgentTabPin(
  serverId: string,
  tab: WorkspaceTabDescriptor,
): AgentTabPin | undefined {
  const ownerServerId = useWorkspaceTabOwnerResolver()?.(tab.tabId)?.serverId ?? serverId;
  const key = tab.target.kind === "agent" ? taskKey(ownerServerId, tab.target.agentId) : null;
  const pinned = usePinnedTasksStore((state) => key !== null && state.keys.includes(key));
  return useMemo(
    () =>
      key === null
        ? undefined
        : { pinned, toggle: () => usePinnedTasksStore.getState().togglePin(key) },
    [key, pinned],
  );
}
