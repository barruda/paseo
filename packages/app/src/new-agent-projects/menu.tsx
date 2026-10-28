// CUSTOM(new-agent-projects): the + menu's Agent row opens a project flyout on hover, so a new
// agent starts in another project in one click. Pressing the row still launches the default agent.
import { useCallback, useMemo } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ProjectIconView } from "@/components/project-icon-view";
import { useToast } from "@/contexts/toast-context";
import { DropdownMenuHint, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { MenuPageDefinition } from "@/components/ui/menu";
import { useProjectFavoritesStore } from "@/composer/project-favorites-store";
import { resolveComposerProjectIdentity } from "@/composer/project-icon-model";
import { useHostProjects } from "@/projects/host-projects";
import { useProjectIcons } from "@/projects/icons";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";
import { generateDraftId } from "@/stores/draft-keys";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { activeDeskTab, useDesksStore } from "@/task-navigation/desks-store";
import { launchDeskTarget } from "@/task-navigation/new-tab-menu";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { favoritesFirst, listNewAgentProjects, type NewAgentProject } from "./model";

export const NEW_AGENT_PROJECTS_PAGE_ID = "new-agent-projects";

export function buildNewAgentProjectsPage(input: {
  serverId: string;
  paneId?: string;
  launchDefault: () => void;
}): MenuPageDefinition {
  return {
    id: NEW_AGENT_PROJECTS_PAGE_ID,
    title: "New agent in",
    content: <NewAgentProjectList {...input} />,
  };
}

/** Mounted only while the flyout is open, so closed + menus don't watch projects or icons. */
function NewAgentProjectList({
  serverId,
  paneId,
  launchDefault,
}: {
  serverId: string;
  paneId?: string;
  launchDefault: () => void;
}) {
  const workspaces = useSessionStore((state) => state.sessions[serverId]?.workspaces);
  const hostProjectRecords = useSessionStore((state) => state.sessions[serverId]?.projects);
  const projects = useMemo(
    () => listNewAgentProjects(workspaces?.values(), hostProjectRecords?.values()),
    [workspaces, hostProjectRecords],
  );
  const client = useHostRuntimeClient(serverId);
  const toast = useToast();
  const currentProjectId = useCurrentProjectId(serverId);
  const serverIds = useMemo(() => [serverId], [serverId]);
  const hostProjects = useHostProjects(serverIds);
  const identities = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          project.projectId,
          resolveComposerProjectIdentity({
            serverId,
            projectId: project.projectId,
            projects: hostProjects,
          }),
        ]),
      ),
    [projects, serverId, hostProjects],
  );
  const iconTargets = useMemo(
    () => [...identities.values()].flatMap((identity) => (identity ? [identity.target] : [])),
    [identities],
  );
  const icons = useProjectIcons({ projects: iconTargets });
  const favoriteKeys = useProjectFavoritesStore((state) => state.keys);
  const sortedProjects = useMemo(
    () =>
      favoritesFirst(projects, (project) => {
        const key = identities.get(project.projectId)?.target.projectViewKey;
        return key !== undefined && favoriteKeys.includes(key);
      }),
    [projects, identities, favoriteKeys],
  );

  const openIn = useCallback(
    (workspaceId: string) => {
      if (useTaskNavigationStore.getState().enabled) {
        launchDeskTarget(
          { serverId, workspaceId },
          { kind: "draft", draftId: generateDraftId() },
          { kind: "open", paneId },
        );
        return;
      }
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: { kind: "draft", draftId: "new" },
      });
    },
    [paneId, serverId],
  );

  const launch = useCallback(
    (project: NewAgentProject) => {
      // The launcher already targets the current workspace, worktree included.
      if (project.projectId === currentProjectId) {
        launchDefault();
        return;
      }
      if (project.workspaceId) {
        openIn(project.workspaceId);
        return;
      }
      if (!client) {
        toast.error("Host is disconnected");
        return;
      }
      // A project added without a workspace (e.g. a git worktree): give it one in its root first.
      void createProjectWorkspace(client, serverId, project)
        .then(openIn)
        .catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : "Could not open the project"),
        );
    },
    [client, currentProjectId, launchDefault, openIn, serverId, toast],
  );

  if (projects.length === 0) {
    return <DropdownMenuHint>No projects</DropdownMenuHint>;
  }
  return sortedProjects.map((project) => {
    const identity = identities.get(project.projectId) ?? null;
    return (
      <NewAgentProjectItem
        key={project.projectId}
        project={project}
        iconDataUri={identity ? (icons.get(identity.target.projectViewKey) ?? null) : null}
        initial={identity?.initial ?? (project.label.charAt(0).toUpperCase() || "?")}
        projectViewKey={identity?.target.projectViewKey ?? project.projectId}
        onLaunch={launch}
      />
    );
  });
}

async function createProjectWorkspace(
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>,
  serverId: string,
  project: NewAgentProject,
): Promise<string> {
  const payload = await client.createWorkspace({
    idempotencyKey: generateDraftId(),
    source: { kind: "directory", path: project.rootPath, projectId: project.projectId },
  });
  if (payload.error || !payload.workspace) {
    throw new Error(payload.error ?? "Could not open the project");
  }
  const workspace = normalizeWorkspaceDescriptor(payload.workspace);
  getHostRuntimeStore().acceptWorkspaceSnapshots(serverId, [workspace]);
  return workspace.id;
}

function NewAgentProjectItem({
  project,
  iconDataUri,
  initial,
  projectViewKey,
  onLaunch,
}: {
  project: NewAgentProject;
  iconDataUri: string | null;
  initial: string;
  projectViewKey: string;
  onLaunch: (project: NewAgentProject) => void;
}) {
  const leading = useMemo(
    () => (
      <ProjectIconView
        iconDataUri={iconDataUri}
        initial={initial}
        projectViewKey={projectViewKey}
        size={14}
        textStyle={styles.initial}
      />
    ),
    [iconDataUri, initial, projectViewKey],
  );
  const trailing = useMemo(
    () =>
      project.branch ? (
        <Text style={styles.branch} numberOfLines={1}>
          {project.branch}
        </Text>
      ) : null,
    [project.branch],
  );
  const handleSelect = useCallback(() => onLaunch(project), [onLaunch, project]);
  return (
    <DropdownMenuItem
      leading={leading}
      trailing={trailing}
      onSelect={handleSelect}
      testID={`new-agent-project-${project.projectId}`}
    >
      {project.label}
    </DropdownMenuItem>
  );
}

/** The project the + menu's launcher works in: the focused Desk tab's, or the route workspace's. */
function useCurrentProjectId(serverId: string): string | null {
  const tasksMode = useTaskNavigationStore((state) => state.enabled);
  const deskTab = useDesksStore((state) => (tasksMode ? activeDeskTab(state) : null));
  const route = useActiveWorkspaceSelection();
  const owner = tasksMode ? deskTab : route;
  return useSessionStore((state) =>
    owner && owner.serverId === serverId
      ? (state.sessions[serverId]?.workspaces.get(owner.workspaceId)?.projectId ?? null)
      : null,
  );
}

const styles = StyleSheet.create((theme) => ({
  initial: { fontSize: 9, fontWeight: theme.fontWeight.medium },
  branch: {
    maxWidth: 140,
    marginLeft: theme.spacing[3],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    opacity: 0.7,
  },
}));
