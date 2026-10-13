// CUSTOM(composer-project-icon): identify the current project beside the context meter.
import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ProjectIconView } from "@/components/project-icon-view";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHostProjects } from "@/projects/host-projects";
import { useProjectIcons } from "@/projects/icons";
import { useSessionStore } from "@/stores/session-store";
import { resolveComposerProjectIdentity } from "./project-icon-model";

interface ComposerProjectIconProps {
  serverId: string;
  agentId: string;
  workspaceId: string | null | undefined;
  size: number;
}

export function ComposerProjectIcon({
  serverId,
  agentId,
  workspaceId,
  size,
}: ComposerProjectIconProps) {
  const projectId = useSessionStore((state) => {
    const session = state.sessions[serverId];
    const resolvedWorkspaceId = workspaceId ?? session?.agents.get(agentId)?.workspaceId;
    if (!session || !resolvedWorkspaceId) return null;
    return session.workspaces.get(resolvedWorkspaceId)?.projectId ?? null;
  });
  const serverIds = useMemo(() => [serverId], [serverId]);
  const projects = useHostProjects(serverIds);
  const identity = useMemo(
    () => resolveComposerProjectIdentity({ serverId, projectId, projects }),
    [serverId, projectId, projects],
  );
  const targets = useMemo(() => (identity ? [identity.target] : []), [identity]);
  const icons = useProjectIcons({ projects: targets });
  if (!identity) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <View style={styles.slot} accessibilityLabel={identity.name} testID="composer-project-icon">
          <ProjectIconView
            iconDataUri={icons.get(identity.target.projectViewKey) ?? null}
            initial={identity.initial}
            projectViewKey={identity.target.projectViewKey}
            size={size}
            textStyle={styles.initial}
          />
        </View>
      </TooltipTrigger>
      <TooltipContent side="top">
        <Text style={styles.name}>{identity.name}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  slot: { width: 28, height: 28, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  initial: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium },
  name: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
}));
