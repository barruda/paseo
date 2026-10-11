/** How many workspaces each project shows in the sidebar, and how old they may be. */
export interface SidebarWorkspaceLimit {
  /** `null` shows every workspace. */
  maxPerProject: number | null;
  /** `null` shows workspaces of any age. */
  maxAgeHours: number | null;
}

export const DEFAULT_SIDEBAR_WORKSPACE_LIMIT: SidebarWorkspaceLimit = {
  maxPerProject: 3,
  maxAgeHours: 12,
};

export const MAX_PER_PROJECT_CHOICES: readonly (number | null)[] = [3, 5, 10, null];
export const MAX_AGE_HOURS_CHOICES: readonly (number | null)[] = [6, 12, 24, 72, null];

export interface LimitedProject {
  viewKey: string;
  workspaces: readonly { workspaceKey: string }[];
}

export interface SidebarWorkspaceLimitResult {
  /** Workspaces the sidebar leaves out right now (expanded projects hide nothing). */
  hiddenWorkspaceKeys: Set<string>;
  /** Projects where the limit leaves something out, expanded or not: they get Show more/less. */
  limitedProjectKeys: Set<string>;
}

/**
 * Both rules apply together: a workspace shows only if it is younger than `maxAgeHours` AND among
 * its project's `maxPerProject` most recent ones. Age is the row's timestamp (`statusEnteredAt`).
 * `keepWorkspaceKeys` (the open workspace) always show and don't count toward the cap. A workspace
 * with no known timestamp is never hidden for its age and ranks last for the cap.
 */
export function limitSidebarWorkspaces(input: {
  projects: readonly LimitedProject[];
  enteredAtByKey: ReadonlyMap<string, Date | null>;
  limit: SidebarWorkspaceLimit;
  now: number;
  keepWorkspaceKeys: ReadonlySet<string>;
  expandedProjectKeys: ReadonlySet<string>;
}): SidebarWorkspaceLimitResult {
  const hiddenWorkspaceKeys = new Set<string>();
  const limitedProjectKeys = new Set<string>();
  const { maxPerProject, maxAgeHours } = input.limit;
  if (maxPerProject === null && maxAgeHours === null) {
    return { hiddenWorkspaceKeys, limitedProjectKeys };
  }
  const cutoff = maxAgeHours === null ? -Infinity : input.now - maxAgeHours * 60 * 60 * 1000;

  for (const project of input.projects) {
    const hidden: string[] = [];
    const candidates: { key: string; at: number }[] = [];
    for (const workspace of project.workspaces) {
      const key = workspace.workspaceKey;
      if (input.keepWorkspaceKeys.has(key)) continue;
      const at = input.enteredAtByKey.get(key)?.getTime() ?? null;
      if (at !== null && at < cutoff) hidden.push(key);
      else candidates.push({ key, at: at ?? -Infinity });
    }
    if (maxPerProject !== null && candidates.length > maxPerProject) {
      // Stable sort: equal timestamps keep their sidebar order.
      const ranked = [...candidates].sort((a, b) => b.at - a.at);
      for (const { key } of ranked.slice(maxPerProject)) hidden.push(key);
    }
    if (hidden.length === 0) continue;
    limitedProjectKeys.add(project.viewKey);
    if (input.expandedProjectKeys.has(project.viewKey)) continue;
    for (const key of hidden) hiddenWorkspaceKeys.add(key);
  }
  return { hiddenWorkspaceKeys, limitedProjectKeys };
}
