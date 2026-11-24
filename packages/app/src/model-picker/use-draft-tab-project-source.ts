import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { activeDeskTab, useDesksStore } from "@/task-navigation/desks-store";
import { useSessionStore } from "@/stores/session-store";
import { router } from "expo-router";
import { useCallback, useMemo } from "react";
import {
  getHostProjectId,
  getHostProjectSourceDirectory,
  useHostProjects,
} from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
// CUSTOM(composer-project-order)
import { draftTabProjectChoices } from "@/composer/project-picker-order";
import { useToast } from "@/contexts/toast-context";
import { createProjectWorkspace } from "@/new-agent-projects/create-project-workspace";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import type { ModelPickerProjectSource } from "./project";

/**
 * The Project row for an empty agent tab. The tab belongs to its workspace, so picking another
 * project opens New Workspace for it in workspace mode. Desks can move a draft reference
 * to an existing workspace while retaining its prompt and model configuration; a project with no
 * workspace yet gets one in its root first (CUSTOM(composer-project-order)).
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
  // CUSTOM(composer-project-order): every project, sorted by name. Tasks mode used to list only
  // projects with a workspace, so a project added without one never showed up here.
  const choices = useMemo(
    () => draftTabProjectChoices({ projects, serverId, allowAllProjects, current }),
    [allowAllProjects, current, projects, serverId],
  );
  const client = useHostRuntimeClient(serverId);
  const toast = useToast();
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
        const moveDraft = (workspace: WorkspaceDescriptor) => {
          const store = useDesksStore.getState();
          const tab = activeDeskTab(store);
          if (tab?.id !== tabId || tab.target.kind !== "draft") return;
          const selectedSetup = setup ?? tab.target.setup;
          store.updateTab(tabId, {
            workspaceId: workspace.id,
            target: {
              ...tab.target,
              setup: selectedSetup
                ? { ...selectedSetup, cwd: workspace.workspaceDirectory }
                : undefined,
            },
          });
        };
        if (target) {
          moveDraft(target);
          return;
        }
        // CUSTOM(composer-project-order): a project added without a workspace gets one in its
        // root, like the + menu's Agent flyout does.
        const rootPath = getHostProjectSourceDirectory(project, serverId);
        if (!projectId || !rootPath) return;
        if (!client) {
          toast.error("Host is disconnected");
          return;
        }
        void createProjectWorkspace(client, serverId, { projectId, rootPath })
          .then(moveDraft)
          .catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : "Could not open the project"),
          );
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
    [choices, client, serverId, tasksMode, tabId, toast, workspaces, setup],
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
