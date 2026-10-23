// CUSTOM(agent-tab-project-icon): agent tabs show their project's icon instead of the provider's,
// so tabs from different projects tell apart at a glance.
import { useMemo, type ComponentType } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ProjectIconView } from "@/components/project-icon-view";
import { resolveComposerProjectIdentity } from "@/composer/project-icon-model";
import { useHostProjects } from "@/projects/host-projects";
import { useProjectIcons } from "@/projects/icons";
import { useSessionStore } from "@/stores/session-store";
import type { PanelIconProps } from "./panel-registry";

/** The project icon of the agent's workspace, or null while the project is unknown. */
export function useAgentProjectTabIcon(
  serverId: string,
  agentId: string,
): ComponentType<PanelIconProps> | null {
  const workspaceId = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (
      session?.agents.get(agentId)?.workspaceId ??
      session?.agentDetails?.get(agentId)?.workspaceId ??
      null
    );
  });
  return useWorkspaceProjectTabIcon(serverId, workspaceId);
}

/**
 * CUSTOM(draft-agent-title): the same icon for a tab that only knows its workspace, such as a New
 * Agent tab. It follows the workspace, so a Desk draft moved to another project updates.
 */
export function useWorkspaceProjectTabIcon(
  serverId: string,
  workspaceId: string | null,
): ComponentType<PanelIconProps> | null {
  const projectId = useSessionStore((state) =>
    workspaceId ? (state.sessions[serverId]?.workspaces.get(workspaceId)?.projectId ?? null) : null,
  );
  const serverIds = useMemo(() => [serverId], [serverId]);
  const projects = useHostProjects(serverIds);
  const identity = useMemo(
    () => resolveComposerProjectIdentity({ serverId, projectId, projects }),
    [serverId, projectId, projects],
  );
  const targets = useMemo(() => (identity ? [identity.target] : []), [identity]);
  const icons = useProjectIcons({ projects: targets });
  const projectViewKey = identity?.target.projectViewKey ?? null;
  const iconDataUri = projectViewKey ? (icons.get(projectViewKey) ?? null) : null;
  const initial = identity?.initial ?? "";
  return useMemo(() => {
    if (!projectViewKey) return null;
    function AgentProjectTabIcon({ size }: PanelIconProps) {
      return (
        <View testID="agent-tab-project-icon">
          <ProjectIconView
            iconDataUri={iconDataUri}
            initial={initial}
            projectViewKey={projectViewKey!}
            size={size}
            textStyle={styles.initial}
          />
        </View>
      );
    }
    return AgentProjectTabIcon;
  }, [projectViewKey, iconDataUri, initial]);
}

const styles = StyleSheet.create((theme) => ({
  initial: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium },
}));
