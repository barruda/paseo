import { useEffect, useMemo, useState } from "react";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import type { SidebarWorkspacePlacement } from "@/hooks/use-sidebar-workspaces-list";
import { useSessionStore } from "@/stores/session-store";
import { collectRecentlyActiveWorkspaces } from "./model";

// Workspaces age out of the window with no store change to notice it; re-check this often.
const TICK_MS = 30_000;

/**
 * What the sidebar shows, in its order: pinned chats, then each project's workspaces (or the
 * status groups in status mode), collapsed projects included, filtered-out workspaces excluded.
 */
export function useSidebarWorkspaceOrder(): SidebarWorkspacePlacement[] {
  const { pinnedGroups, groupMode, workspaceGroups } = useSidebarModel();
  return useMemo(
    () => [
      ...pinnedGroups.pinnedChats,
      ...(groupMode === "project"
        ? pinnedGroups.unpinnedProjects.flatMap((project) => project.workspaces)
        : workspaceGroups.flatMap((group) => group.rows)),
    ],
    [groupMode, pinnedGroups, workspaceGroups],
  );
}

/** The sidebar's workspaces that Shift+Tab cycles through right now, kept live for the sidebar. */
export function useRecentlyActiveWorkspaces(): SidebarWorkspacePlacement[] {
  const order = useSidebarWorkspaceOrder();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(interval);
  }, []);
  // A joined key string, so agent activity re-renders the section only when the set changes.
  const keys = useSessionStore((state) =>
    collectRecentlyActiveWorkspaces({
      order,
      sessions: state.sessions,
      agentLastActivity: state.agentLastActivity,
      now,
    })
      .map((target) => target.workspaceKey)
      .join("\n"),
  );
  return useMemo(() => {
    const wanted = new Set(keys ? keys.split("\n") : []);
    const seen = new Set<string>();
    return order.filter((target) => {
      if (!wanted.has(target.workspaceKey) || seen.has(target.workspaceKey)) return false;
      seen.add(target.workspaceKey);
      return true;
    });
  }, [keys, order]);
}
