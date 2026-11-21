import { useCallback, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  FileExplorerCloseGestureContext,
  useCloseFileExplorerGesture,
} from "@/mobile-panels/gestures";
import { useIsMobilePanelActive } from "@/mobile-panels/provider";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { resolveExplorerSidebarWidth } from "@/components/explorer-sidebar-layout";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useExplorerLockWidth } from "@/explorer-lock/use-explorer-lock-width"; // CUSTOM(explorer-lock): locked width
import type { ExplorerLockMode } from "@/explorer-lock/model"; // CUSTOM(explorer-lock)
import { useExplorerGeometry } from "./geometry";
import type { ExplorerFrameProps } from "./frame-props";

function ExplorerFrameBase({
  children,
  surfaceColor,
  presentation,
  isOpen,
  isWorkspaceActive,
  persistenceKey,
  lockedWidth, // CUSTOM(explorer-lock)
}: ExplorerFrameProps & { lockedWidth?: LockedExplorerWidth }) {
  const [containerWidth, setContainerWidth] = useState(0);
  const measureContainer = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    const { width, height } = nativeEvent.layout;
    if (width > 0 && height > 0) setContainerWidth(width);
  }, []);
  const overlay = presentation === "overlay";
  const settledOpen = useIsMobilePanelActive("file-explorer");
  const active = isWorkspaceActive && (overlay ? settledOpen : isOpen);
  const resizeEnabled = isWorkspaceActive && !overlay && isOpen;
  const { gesture, gestureRef } = useCloseFileExplorerGesture(isWorkspaceActive && overlay);
  const storedWidth = useWorkspaceLayoutStore(
    (state) => state.explorerSidebarWidthByWorkspace[persistenceKey],
  );
  const resize = useWorkspaceLayoutStore((state) => state.resizeExplorerSidebar);
  const onResize = useCallback(
    (width: number) => resize(persistenceKey, width),
    [persistenceKey, resize],
  );
  // CUSTOM(explorer-lock): locked, one shared width replaces the per-workspace one.
  const requestedWidth = lockedWidth ? lockedWidth.requestedWidth : storedWidth;
  const geometry = useExplorerGeometry({
    width: resolveExplorerSidebarWidth({ requestedWidth, containerWidth }),
    containerWidth,
    overlay,
    resizeEnabled,
    onResize: lockedWidth?.onResize ?? onResize, // CUSTOM(explorer-lock)
  });
  return (
    <RetainedPanelActivity active={active}>
      <FileExplorerCloseGestureContext value={gestureRef}>
        <MobilePanelOverlay
          panel="file-explorer"
          closeGesture={gesture}
          presentation={presentation}
          dockVisible={isOpen}
          frameStyle={geometry.frameStyle}
          panelStyle={[{ backgroundColor: surfaceColor }, geometry.panelStyle]}
        >
          <View style={styles.content}>
            {resizeEnabled ? geometry.resizeHandle : null}
            {children}
          </View>
        </MobilePanelOverlay>
      </FileExplorerCloseGestureContext>
      <View pointerEvents="none" style={styles.measurement} onLayout={measureContainer} />
    </RetainedPanelActivity>
  );
}
const StyledExplorerFrame = withUnistyles(ExplorerFrameBase, (theme) => ({
  surfaceColor: theme.colors.surfaceSidebar,
}));

// CUSTOM(explorer-lock): a frame given a `lockMode` reads the lock setting (react-query) in its own
// wrapper, so a frame without one keeps working outside the app's providers.
interface LockedExplorerWidth {
  requestedWidth: number | undefined;
  onResize: (width: number) => void;
}

function LockedExplorerFrame({
  lockMode,
  ...props
}: ExplorerFrameProps & { lockMode: ExplorerLockMode }) {
  const ownWidth = useWorkspaceLayoutStore(
    (state) => state.explorerSidebarWidthByWorkspace[props.persistenceKey],
  );
  const resize = useWorkspaceLayoutStore((state) => state.resizeExplorerSidebar);
  const { persistenceKey } = props;
  const resizeOwn = useCallback(
    (width: number) => resize(persistenceKey, width),
    [persistenceKey, resize],
  );
  const lockedWidth = useExplorerLockWidth({
    mode: lockMode,
    overlay: props.presentation === "overlay",
    active: props.isWorkspaceActive,
    ownWidth,
    resizeOwn,
  });
  return <StyledExplorerFrame {...props} lockedWidth={lockedWidth} />;
}

export function ExplorerFrame({ lockMode, ...props }: ExplorerFrameProps) {
  if (lockMode) return <LockedExplorerFrame {...props} lockMode={lockMode} />;
  return <StyledExplorerFrame {...props} />;
}
const styles = StyleSheet.create({
  content: { flex: 1, minHeight: 0 },
  // Measure the workspace row even when the dock is closed. The gesture host stays in its slot.
  measurement: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
});
