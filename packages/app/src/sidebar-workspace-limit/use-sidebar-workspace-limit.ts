import { useEffect, useMemo, useState } from "react";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { limitSidebarWorkspaces, type SidebarWorkspaceLimitResult } from "./model";
import { useSidebarWorkspaceLimitStore } from "./store";

// Workspaces age past the limit with no store change to notice it; re-check this often.
const TICK_MS = 60_000;

/**
 * What the per-project limit leaves out of the project-mode sidebar. Identity changes only when
 * the result does, so the minute tick doesn't rebuild the sidebar projection.
 */
export function useSidebarWorkspaceLimit(input: {
  enabled: boolean;
  projects: readonly SidebarProjectEntry[];
  entriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  /** Pinned workspaces sit in Pinned, not in their project: they neither count nor hide. */
  pinnedWorkspaceKeys: readonly string[];
}): SidebarWorkspaceLimitResult {
  const { enabled, projects, entriesByKey, pinnedWorkspaceKeys } = input;
  const maxPerProject = useSidebarWorkspaceLimitStore((state) => state.maxPerProject);
  const maxAgeHours = useSidebarWorkspaceLimitStore((state) => state.maxAgeHours);
  const expandedProjectKeys = useSidebarWorkspaceLimitStore((state) => state.expandedProjectKeys);
  const active = useActiveWorkspaceSelection();
  const activeKey = active ? `${active.serverId}:${active.workspaceId}` : null;
  const [now, setNow] = useState(() => Date.now());
  const ticking = enabled && maxAgeHours !== null;
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(interval);
  }, [ticking]);

  const signature = useMemo(() => {
    if (!enabled) return ["", ""];
    const enteredAtByKey = new Map<string, Date | null>();
    for (const [key, entry] of entriesByKey) enteredAtByKey.set(key, entry.statusEnteredAt);
    const result = limitSidebarWorkspaces({
      projects,
      enteredAtByKey,
      limit: { maxPerProject, maxAgeHours },
      now,
      // Workspace keys are `serverId:workspaceId`.
      keepWorkspaceKeys: new Set(
        activeKey ? [...pinnedWorkspaceKeys, activeKey] : pinnedWorkspaceKeys,
      ),
      expandedProjectKeys,
    });
    return [[...result.hiddenWorkspaceKeys].join("\n"), [...result.limitedProjectKeys].join("\n")];
  }, [
    activeKey,
    enabled,
    entriesByKey,
    expandedProjectKeys,
    maxAgeHours,
    maxPerProject,
    now,
    pinnedWorkspaceKeys,
    projects,
  ]);

  // Rebuilt from joined keys, so the result only changes identity when its contents change.
  const [hidden, limited] = signature;
  return useMemo(
    () => ({
      hiddenWorkspaceKeys: new Set(hidden ? hidden.split("\n") : []),
      limitedProjectKeys: new Set(limited ? limited.split("\n") : []),
    }),
    [hidden, limited],
  );
}
