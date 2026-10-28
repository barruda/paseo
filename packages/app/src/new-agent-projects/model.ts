// CUSTOM(new-agent-projects): the projects the + menu's Agent flyout offers, one row per project.
import type { ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";

export interface NewAgentProject {
  projectId: string;
  label: string;
  /** The workspace the new agent opens in: the project's main checkout when there is one. Null
   * when the project has no workspace yet; launching creates one in `rootPath`. */
  workspaceId: string | null;
  rootPath: string;
  /** The workspace's checked-out branch, shown faintly beside the name. */
  branch: string | null;
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
  | "gitRuntime"
>;

type HostProject = Pick<
  ProjectDescriptor,
  "projectId" | "projectDisplayName" | "projectCustomName" | "projectRootPath"
>;

/** Projects on the host, sorted by name. Worktrees stand in only when the project has no main
 * checkout. A project added without a workspace (e.g. a git worktree added as its own project)
 * still gets a row, with no workspace. */
export function listNewAgentProjects(
  workspaces: Iterable<ProjectWorkspace> | null | undefined,
  projects?: Iterable<HostProject> | null,
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
        rootPath: workspace.projectRootPath,
        branch: workspace.gitRuntime?.currentBranch?.trim() || null,
      },
    });
  }
  for (const project of projects ?? []) {
    if (byProject.has(project.projectId)) continue;
    byProject.set(project.projectId, {
      isMain: false,
      project: {
        projectId: project.projectId,
        label: project.projectCustomName?.trim() || project.projectDisplayName,
        workspaceId: null,
        rootPath: project.projectRootPath,
        branch: null,
      },
    });
  }
  return [...byProject.values()]
    .map((entry) => entry.project)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** CUSTOM(project-favorites): starred projects first, each group keeping its name order. */
export function favoritesFirst<T>(
  projects: readonly T[],
  isFavorite: (project: T) => boolean,
): T[] {
  return [...projects.filter(isFavorite), ...projects.filter((project) => !isFavorite(project))];
}
