// CUSTOM(bottom-panel-warp-tab-button): a + inside the bottom panel's Warp tab chip opens a new tab
// inside Warp, in the folder of the agent's project: in Tasks mode the last focused agent tab's
// workspace, in a workspace the workspace itself.
import { Plus } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { Theme } from "@/styles/theme";
import { deskContextTab, useDesksStore } from "@/task-navigation/desks-store";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { openWarpSession } from "./warp-session";

const ThemedPlus = withUnistyles(Plus);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const BUTTON_SIZE = 18;
const CLOSE_BUTTON_SPAN = 22;
/** The width a Warp chip adds so its label ends before the +. */
export const WARP_CHIP_NEW_TAB_WIDTH = BUTTON_SIZE + 4;

// The chip is a drag handle; a press on the + must not start a drag.
const dragBlockers = isWeb
  ? ({
      onPointerDown: (event: { stopPropagation?: () => void }) => event.stopPropagation?.(),
      onMouseDown: (event: { stopPropagation?: () => void }) => event.stopPropagation?.(),
    } as const)
  : undefined;

/** Renders nothing unless the row marked the chip as a bottom-panel Warp tab (`workspaceId`). */
export function WarpChipNewTabButton({
  tabId,
  target,
  serverId,
  workspaceId,
  closeShown,
  onNavigateTab,
}: {
  tabId: string;
  target: WorkspaceTabTarget;
  serverId: string;
  workspaceId: string | undefined;
  /** The chip's × is showing at its right edge, so the + moves left of it. */
  closeShown: boolean;
  onNavigateTab: (tabId: string) => void;
}) {
  const tasksMode = useTaskNavigationStore((state) => state.enabled);
  const contextTab = useDesksStore((state) => (tasksMode ? deskContextTab(state) : null));
  const owner = contextTab ?? { serverId, workspaceId: workspaceId ?? "" };
  const browserId = target.kind === "browser" ? target.browserId : null;
  const directory = useSessionStore(
    (state) =>
      state.sessions[owner.serverId]?.workspaces.get(owner.workspaceId)?.workspaceDirectory ?? null,
  );

  const handlePress = useCallback(() => {
    if (!directory || !browserId) return;
    onNavigateTab(tabId);
    void openWarpSession(browserId, directory);
  }, [browserId, directory, onNavigateTab, tabId]);

  if (workspaceId === undefined || !browserId || !directory) return null;
  return (
    <Pressable
      {...(dragBlockers as object | undefined)}
      testID="bottom-panel-warp-tab"
      accessibilityRole="button"
      accessibilityLabel={`New Warp tab in ${directory}`}
      onPress={handlePress}
      style={closeShown ? styles.buttonBesideClose : styles.button}
    >
      {({ hovered, pressed }) => (
        <ThemedPlus
          size={13}
          uniProps={hovered || pressed ? foregroundColorMapping : mutedColorMapping}
        />
      )}
    </Pressable>
  );
}

const button = {
  position: "absolute" as const,
  top: "50%" as const,
  marginTop: -BUTTON_SIZE / 2,
  width: BUTTON_SIZE,
  height: BUTTON_SIZE,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  zIndex: 3,
};

const styles = StyleSheet.create((theme) => ({
  button: { ...button, right: 4, borderRadius: theme.borderRadius.sm },
  buttonBesideClose: {
    ...button,
    right: 4 + CLOSE_BUTTON_SPAN,
    borderRadius: theme.borderRadius.sm,
  },
}));
