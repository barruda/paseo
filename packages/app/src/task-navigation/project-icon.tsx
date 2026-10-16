// CUSTOM(desks): share the workspace sidebar's project identity and icon cache.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useShallow } from "zustand/react/shallow";
import { useHosts } from "@/runtime/host-runtime";
import { useHostProjects } from "@/projects/host-projects";
import { useSessionStore } from "@/stores/session-store";
import { resolveComposerProjectIdentity } from "@/composer/project-icon-model";
import { ProjectIconView } from "@/components/project-icon-view";
import { useProjectIcons } from "@/projects/icons";
import { projectIconPlaceholderLabelFromDisplayName } from "@/utils/project-display-name";

const ProjectIconsContext = createContext<
  ReadonlyMap<string, { name: string; key: string; icon: string | null }>
>(new Map());

export function TaskProjectIconsProvider({ children }: { children: ReactNode }) {
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const projects = useHostProjects(serverIds);
  const workspacesByHost = useSessionStore(
    useShallow((state) => serverIds.map((serverId) => state.sessions[serverId]?.workspaces)),
  );
  const identities = useMemo(() => {
    const result = new Map<
      string,
      NonNullable<ReturnType<typeof resolveComposerProjectIdentity>>
    >();
    serverIds.forEach((serverId, index) => {
      for (const workspace of workspacesByHost[index]?.values() ?? []) {
        const identity = resolveComposerProjectIdentity({
          serverId,
          projectId: workspace.projectId,
          projects,
        });
        if (identity) result.set(`${serverId}:${workspace.id}`, identity);
      }
    });
    return result;
  }, [serverIds, workspacesByHost, projects]);
  const targets = useMemo(
    () => [...identities.values()].map((identity) => identity.target),
    [identities],
  );
  const icons = useProjectIcons({ projects: targets });
  const value = useMemo(
    () =>
      new Map(
        [...identities].map(([key, identity]) => [
          key,
          {
            name: identity.name,
            key: identity.target.projectViewKey,
            icon: icons.get(identity.target.projectViewKey) ?? null,
          },
        ]),
      ),
    [identities, icons],
  );
  return <ProjectIconsContext.Provider value={value}>{children}</ProjectIconsContext.Provider>;
}

export function TaskProjectIcon({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const workspace = useContext(ProjectIconsContext).get(`${serverId}:${workspaceId}`);
  if (!workspace) return null;
  return (
    <View accessibilityLabel={workspace.name} testID="task-project-icon">
      <ProjectIconView
        iconDataUri={workspace.icon}
        projectViewKey={workspace.key}
        initial={projectIconPlaceholderLabelFromDisplayName(workspace.name).charAt(0).toUpperCase()}
        size={16}
        textStyle={styles.initial}
      />
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  initial: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium },
}));
