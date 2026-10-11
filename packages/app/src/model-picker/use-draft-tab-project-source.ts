import { router } from "expo-router";
import { useCallback, useMemo } from "react";
import {
  filterWorkspaceProjectsForHost,
  getHostProjectId,
  getHostProjectSourceDirectory,
  useHostProjects,
} from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import type { ModelPickerProjectSource } from "./project";

/**
 * The Project row for an empty agent tab. The tab belongs to its workspace, so picking another
 * project opens New Workspace for it; the text typed in the tab stays in the tab's draft.
 */
export function useDraftTabProjectSource(
  serverId: string,
  workspaceId: string | null,
): ModelPickerProjectSource | null {
  const serverIds = useMemo(() => [serverId], [serverId]);
  const projects = useHostProjects(serverIds);
  const allowAllProjects = useHostFeature(serverId, "workspaceMultiplicity");
  const workspaceProjectId = useWorkspaceFields(serverId, workspaceId, (w) => w.projectId);
  const current = useMemo(
    () =>
      projects.find((project) => getHostProjectId(project, serverId) === workspaceProjectId) ??
      null,
    [projects, serverId, workspaceProjectId],
  );
  const choices = useMemo(() => {
    const creatable = filterWorkspaceProjectsForHost({ projects, serverId, allowAllProjects });
    return current && !creatable.includes(current) ? [current, ...creatable] : creatable;
  }, [allowAllProjects, current, projects, serverId]);
  const select = useCallback(
    (viewKey: string) => {
      const project = choices.find((entry) => entry.viewKey === viewKey);
      if (!project) return;
      router.push(
        buildNewWorkspaceRoute({
          serverId,
          sourceDirectory: getHostProjectSourceDirectory(project, serverId) ?? undefined,
          projectId: getHostProjectId(project, serverId) ?? undefined,
          displayName: project.projectName,
        }),
      );
    },
    [choices, serverId],
  );
  return useMemo(
    () =>
      choices.length > 0
        ? {
            selectedId: current?.viewKey ?? null,
            options: choices.map((project) => ({
              id: project.viewKey,
              label: project.projectName,
            })),
            select,
            leavesComposer: true,
          }
        : null,
    [choices, current, select],
  );
}
