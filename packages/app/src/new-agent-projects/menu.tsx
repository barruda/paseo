// CUSTOM(new-agent-projects): the + menu's Agent row opens a project flyout on hover, so a new
// agent starts in another project in one click. Pressing the row still launches the default agent.
import { useCallback, useMemo } from "react";
import { StyleSheet } from "react-native-unistyles";
import { ProjectIconView } from "@/components/project-icon-view";
import { DropdownMenuHint, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { MenuPageDefinition } from "@/components/ui/menu";
import { resolveComposerProjectIdentity } from "@/composer/project-icon-model";
import { useHostProjects } from "@/projects/host-projects";
import { useProjectIcons } from "@/projects/icons";
import { generateDraftId } from "@/stores/draft-keys";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { activeDeskTab, useDesksStore } from "@/task-navigation/desks-store";
import { launchDeskTarget } from "@/task-navigation/new-tab-menu";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { listNewAgentProjects, type NewAgentProject } from "./model";

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
  const projects = useMemo(() => listNewAgentProjects(workspaces?.values()), [workspaces]);
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

  const launch = useCallback(
    (project: NewAgentProject) => {
      // The launcher already targets the current workspace, worktree included.
      if (project.projectId === currentProjectId) {
        launchDefault();
        return;
      }
      if (useTaskNavigationStore.getState().enabled) {
        launchDeskTarget(
          { serverId, workspaceId: project.workspaceId },
          { kind: "draft", draftId: generateDraftId() },
          { kind: "open", paneId },
        );
        return;
      }
      navigateToWorkspace({
        serverId,
        workspaceId: project.workspaceId,
        target: { kind: "draft", draftId: "new" },
      });
    },
    [currentProjectId, launchDefault, paneId, serverId],
  );

  if (projects.length === 0) {
    return <DropdownMenuHint>No projects</DropdownMenuHint>;
  }
  return projects.map((project) => {
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
  const handleSelect = useCallback(() => onLaunch(project), [onLaunch, project]);
  return (
    <DropdownMenuItem
      leading={leading}
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
}));
