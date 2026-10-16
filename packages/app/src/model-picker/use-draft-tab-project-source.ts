import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { activeDeskTab, useDesksStore } from "@/task-navigation/desks-store";
import { useSessionStore } from "@/stores/session-store";
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
 * project opens New Workspace for it in workspace mode. Desks can move a draft reference
 * to an existing workspace while retaining its prompt and model configuration.
 */
export function useDraftTabProjectSource(
  serverId: string,
  workspaceId: string | null,
  tabId?: string,
  setup?: Omit<WorkspaceDraftTabSetup, "cwd">,
): ModelPickerProjectSource | null {
  const tasksMode = useTaskNavigationStore((s) => s.enabled);
  const workspaces = useSessionStore((s) => s.sessions[serverId]?.workspaces);
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
    const available =
      tasksMode && tabId
        ? projects.filter((project) =>
            [...(workspaces?.values() ?? [])].some(
              (w) => w.projectId === getHostProjectId(project, serverId),
            ),
          )
        : projects;
    const creatable = filterWorkspaceProjectsForHost({
      projects: available,
      serverId,
      allowAllProjects,
    });
    return current && !creatable.includes(current) ? [current, ...creatable] : creatable;
  }, [allowAllProjects, current, projects, serverId, tasksMode, tabId, workspaces]);
  const select = useCallback(
    (viewKey: string) => {
      const project = choices.find((entry) => entry.viewKey === viewKey);
      if (!project) return;
      if (tasksMode && tabId) {
        const projectId = getHostProjectId(project, serverId);
        const candidates = [...(workspaces?.values() ?? [])].filter(
          (w) => w.projectId === projectId,
        );
        const target =
          candidates.find((w) => w.workspaceDirectory === w.projectRootPath) ?? candidates[0];
        const store = useDesksStore.getState();
        const tab = activeDeskTab(store);
        if (target && tab?.id === tabId && tab.target.kind === "draft") {
          const selectedSetup = setup ?? tab.target.setup;
          store.updateTab(tabId, {
            workspaceId: target.id,
            target: {
              ...tab.target,
              setup: selectedSetup
                ? { ...selectedSetup, cwd: target.workspaceDirectory }
                : undefined,
            },
          });
        }
        return;
      }
      router.push(
        buildNewWorkspaceRoute({
          serverId,
          sourceDirectory: getHostProjectSourceDirectory(project, serverId) ?? undefined,
          projectId: getHostProjectId(project, serverId) ?? undefined,
          displayName: project.projectName,
        }),
      );
    },
    [choices, serverId, tasksMode, tabId, workspaces, setup],
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
            leavesComposer: !tasksMode,
          }
        : null,
    [choices, current, select, tasksMode],
  );
}
