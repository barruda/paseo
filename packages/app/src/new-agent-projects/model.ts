// CUSTOM(new-agent-projects): the projects the + menu's Agent flyout offers, one row per project.
import type { WorkspaceDescriptor } from "@/stores/session-store";

export interface NewAgentProject {
  projectId: string;
  label: string;
  /** The workspace the new agent opens in: the project's main checkout when there is one. */
  workspaceId: string;
}

type ProjectWorkspace = Pick<
  WorkspaceDescriptor,
  | "id"
  | "projectId"
  | "projectDisplayName"
  | "projectCustomName"
  | "projectRootPath"
  | "workspaceDirectory"
  | "archivingAt"
>;

/** Projects that have a workspace on the host, sorted by name. Worktrees stand in only when the
 * project has no main checkout. */
export function listNewAgentProjects(
  workspaces: Iterable<ProjectWorkspace> | null | undefined,
): NewAgentProject[] {
  const byProject = new Map<string, { project: NewAgentProject; isMain: boolean }>();
  for (const workspace of workspaces ?? []) {
    if (workspace.archivingAt || !workspace.projectId) continue;
    const isMain = workspace.workspaceDirectory === workspace.projectRootPath;
    const existing = byProject.get(workspace.projectId);
    if (existing && (existing.isMain || !isMain)) continue;
    byProject.set(workspace.projectId, {
      isMain,
      project: {
        projectId: workspace.projectId,
        label: workspace.projectCustomName?.trim() || workspace.projectDisplayName,
        workspaceId: workspace.id,
      },
    });
  }
  return [...byProject.values()]
    .map((entry) => entry.project)
    .sort((a, b) => a.label.localeCompare(b.label));
}
