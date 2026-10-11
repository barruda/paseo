import { createContext, useContext } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ProjectStatusIndicator } from "@/components/sidebar/project-leading-visual";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";

/**
 * Set by the Recent section: its rows show their project's icon where other rows show
 * the time or the diff. The map is the list's project icons, keyed by `projectViewKey`.
 */
export const RecentWorkspaceTrailingContext = createContext<ReadonlyMap<
  string,
  string | null
> | null>(null);

export function useRecentWorkspaceProjectIcons(): ReadonlyMap<string, string | null> | null {
  return useContext(RecentWorkspaceTrailingContext);
}

export function RecentWorkspaceProjectIcon({
  workspace,
  iconDataUri,
  backdrop,
}: {
  workspace: SidebarWorkspaceEntry;
  iconDataUri: string | null;
  backdrop: SidebarSurfaceBackdrop;
}) {
  return (
    <View style={styles.slot} testID={`sidebar-recent-project-icon-${workspace.workspaceKey}`}>
      <ProjectStatusIndicator
        iconDataUri={iconDataUri}
        displayName={workspace.projectName}
        projectViewKey={workspace.projectViewKey}
        statusBucket={null}
        backdrop={backdrop}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // The trailing slot's height, so the icon doesn't make the row taller than its neighbours.
  slot: {
    height: 20,
    justifyContent: "center",
    alignItems: "flex-end",
  },
});
