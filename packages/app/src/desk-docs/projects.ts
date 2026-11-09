// CUSTOM(desk-docs): the projects the Docs tab lists, read from the hosts' workspaces.
import { useStoreWithEqualityFn } from "zustand/traditional";
import equal from "fast-deep-equal";
import { useSessionStore, type SessionState } from "@/stores/session-store";
import { projectRefOf } from "./model";

export interface DocsProject {
  ref: string;
  serverId: string;
  name: string;
  workspaces: { id: string; directory: string }[];
}

function selectProjects(state: { sessions: Record<string, SessionState> }): DocsProject[] {
  const byRef = new Map<string, DocsProject>();
  for (const [serverId, session] of Object.entries(state.sessions)) {
    for (const workspace of session.workspaces.values()) {
      const ref = projectRefOf(serverId, workspace.projectId);
      let project = byRef.get(ref);
      if (!project) {
        project = {
          ref,
          serverId,
          name: workspace.projectCustomName ?? workspace.projectDisplayName ?? workspace.projectId,
          workspaces: [],
        };
        byRef.set(ref, project);
      }
      project.workspaces.push({ id: workspace.id, directory: workspace.workspaceDirectory });
    }
  }
  return [...byRef.values()];
}

export function useDocsProjects(): DocsProject[] {
  return useStoreWithEqualityFn(useSessionStore, selectProjects, equal);
}

/** The workspace a path opens in: the one whose folder holds it, else the preferred, else the first. */
export function pickOwnerWorkspace(
  project: DocsProject,
  path: string,
  preferredId?: string,
): { id: string; directory: string } | null {
  const holding = project.workspaces.find(
    (workspace) => path === workspace.directory || path.startsWith(`${workspace.directory}/`),
  );
  if (holding) return holding;
  return (
    project.workspaces.find((workspace) => workspace.id === preferredId) ??
    project.workspaces[0] ??
    null
  );
}
