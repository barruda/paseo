// CUSTOM(desk-explorer): the Explorer sidebar (Files, Changes) of the focused task's workspace,
// docked beside a Desk. Its tabs and width live in that workspace's layout, so the workspace view
// and Tasks mode show the same Explorer. Whether it is open belongs to each Desk tab: switching a
// draft's project or focusing another tab never opens it because the workspace has it open.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHasWindowChromeObstruction } from "@/utils/desktop-window";
import { ExplorerSidebarDock } from "@/screens/workspace/explorer-sidebar";
import { WorkspaceTabDragContext } from "@/components/workspace-tab-drag-context";
import { buildWorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import {
  WorkspaceTabMoveProvider,
  WorkspaceTabOwnerProvider,
} from "@/screens/workspace/workspace-tab-owner";
import {
  resolveWorkspaceExplorerToggleOwner,
  type WorkspaceExplorerToggleOwner,
} from "@/screens/workspace/workspace-explorer-toggle";
import {
  collectAllTabs,
  findPaneById,
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import {
  resolveExplorerSidebarPresentation,
  toggleExplorerSidebar,
  useIsExplorerSidebarOpen,
} from "@/workspace-tabs/explorer-sidebar";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";
import { activeDesk, useDesksStore, type DeskTabOwner } from "./desks-store";
import { ensureExplorerPane } from "./desk-explorer-target";
import { lockSwitchTurnedOn, resolveDeskExplorerOpen } from "@/explorer-lock/model"; // CUSTOM(explorer-lock)
import { useExplorerLockSetting } from "@/explorer-lock/settings"; // CUSTOM(explorer-lock)
import { useExplorerLockHydrated, useExplorerLockStore } from "@/explorer-lock/store"; // CUSTOM(explorer-lock)
import { useAssistantTabFollow } from "@/assistant-sidebar/use-assistant-tab-follow"; // CUSTOM(pm-sidebar)

const NO_DESK_DRAG = {
  activeDragTabId: null,
  dropPreview: null,
  tabDropPreview: null,
  laneDropPreview: null,
  externalDndContext: false,
};

const NO_CLOSING_TABS = new Set<string>();
const noop = () => undefined;

export interface DeskExplorer {
  workspaceKey: string | null;
  isOpen: boolean;
  toggleOwner: WorkspaceExplorerToggleOwner;
  toggle: () => void;
}

export function useDeskExplorer(scope: DeskTabOwner | null, tabId: string | null): DeskExplorer {
  const isCompact = useIsCompactFormFactor();
  const hasMacTrafficLights = useHasWindowChromeObstruction("top-left");
  const workspaceKey = scope ? buildWorkspaceTabPersistenceKey(scope) : null;
  const isCompactExplorer = resolveExplorerSidebarPresentation({ isCompact }) === "overlay";
  const isWorkspaceOpen = useIsExplorerSidebarOpen({ isCompact, workspaceKey });
  const isOwnTabOpen = useDesksStore((state) =>
    Boolean(tabId && activeDesk(state).explorerTabIds?.includes(tabId)),
  );
  // CUSTOM(explorer-lock): with the lock on, one saved open/closed state replaces each tab's own.
  const { lockOn, settingsLoaded } = useExplorerLockSetting("tasks");
  const lockHydrated = useExplorerLockHydrated();
  const lockedOpen = useExplorerLockStore((state) => state.open);
  const { locked, open: isTabOpen } = resolveDeskExplorerOpen({
    lockOn,
    hydrated: lockHydrated,
    compact: isCompactExplorer,
    lockedOpen,
    tabOpen: isOwnTabOpen,
  });
  const isOpen = isCompactExplorer ? isWorkspaceOpen : isTabOpen;
  // Turning the lock on keeps what is on screen; the settings arriving on load is not a toggle.
  const lastLockSwitch = useRef({ lockOn, settingsLoaded });
  useEffect(() => {
    const previous = lastLockSwitch.current;
    const current = { lockOn, settingsLoaded };
    lastLockSwitch.current = current;
    if (lockHydrated && lockSwitchTurnedOn(previous, current)) {
      useExplorerLockStore.getState().setOpen(isOwnTabOpen);
    }
  }, [isOwnTabOpen, lockHydrated, lockOn, settingsLoaded]);

  useEffect(() => {
    if (isTabOpen && workspaceKey && !isCompactExplorer) ensureExplorerPane(workspaceKey);
  }, [isCompactExplorer, isTabOpen, workspaceKey]);
  // CUSTOM(pm-sidebar): the Project Manager tab follows the locked sidebar to the next workspace.
  useAssistantTabFollow({ workspaceKey, lockedOpen: locked && isTabOpen });

  // Changes, folder links and plugins reveal the Explorer through the workspace layout; when they
  // do it for the focused tab's workspace, the tab opens its Explorer too.
  const lastWorkspace = useRef({ workspaceKey, isWorkspaceOpen });
  useEffect(() => {
    const last = lastWorkspace.current;
    lastWorkspace.current = { workspaceKey, isWorkspaceOpen };
    if (!tabId || last.workspaceKey !== workspaceKey) return;
    if (!last.isWorkspaceOpen && isWorkspaceOpen) {
      if (locked) useExplorerLockStore.getState().setOpen(true);
      else useDesksStore.getState().setTabExplorerOpen(tabId, true);
    }
  }, [isWorkspaceOpen, locked, tabId, workspaceKey]);

  const toggle = useCallback(() => {
    if (isCompactExplorer) {
      toggleExplorerSidebar({ isCompact, workspaceKey });
      return;
    }
    if (locked) useExplorerLockStore.getState().setOpen(!isTabOpen);
    else if (tabId) useDesksStore.getState().setTabExplorerOpen(tabId, !isTabOpen);
  }, [isCompact, isCompactExplorer, isTabOpen, locked, tabId, workspaceKey]);
  return {
    workspaceKey,
    isOpen,
    toggleOwner: resolveWorkspaceExplorerToggleOwner({
      isMobile: isCompact,
      hasMacTrafficLights,
    }),
    toggle,
  };
}

export interface DeskExplorerDockProps {
  scope: DeskTabOwner;
  workspaceKey: string;
  isFocused: boolean;
  renderHeaderAction: () => ReactNode;
  /** Opens what an Explorer panel asks for (a file, a diff) as a Desk tab. */
  onOpenTarget: (target: WorkspaceTabTarget) => void;
  onCopyResumeCommand: (agentId: string) => void;
  onCopyAgentId: (agentId: string) => void;
  onCopyTerminalId: (terminalId: string) => void;
  onCopyFilePath: (path: string, mode?: "full") => void;
  onOpenFile?: (path: string, mode: "browser" | "default") => void;
  onReloadAgent: (agentId: string) => void;
  onCreateNewTab: (input: { paneId?: string }) => void;
}

export function DeskExplorerDock({
  scope,
  workspaceKey,
  isFocused,
  renderHeaderAction,
  onOpenTarget,
  ...tabActions
}: DeskExplorerDockProps) {
  const [hoveredCloseTabKey, setHoveredCloseTabKey] = useState<string | null>(null);
  const layout = useWorkspaceLayoutStore((state) => state.layoutByWorkspace[workspaceKey] ?? null);
  const paneId = useWorkspaceLayoutStore((state) =>
    selectExplorerSidebarPaneId(state, workspaceKey),
  );
  const pane = layout ? findPaneById(layout.root, paneId) : null;
  const uiTabs = useMemo(() => (layout ? collectAllTabs(layout.root) : []), [layout]);

  const selectTab = useCallback(
    (tabPaneId: string, tabId: string) =>
      useWorkspaceLayoutStore.getState().selectTabInPane(workspaceKey, tabPaneId, tabId),
    [workspaceKey],
  );
  const closeTab = useCallback(
    (tabId: string) => useWorkspaceLayoutStore.getState().closeTab(workspaceKey, tabId),
    [workspaceKey],
  );
  const closeTabsBeside = useCallback(
    (side: "left" | "right" | "others") => (tabId: string, paneTabs: WorkspaceTabDescriptor[]) => {
      const index = paneTabs.findIndex((tab) => tab.tabId === tabId);
      if (index < 0) return;
      let closing = paneTabs.filter((tab) => tab.tabId !== tabId);
      if (side === "left") closing = paneTabs.slice(0, index);
      if (side === "right") closing = paneTabs.slice(index + 1);
      for (const tab of closing) closeTab(tab.tabId);
    },
    [closeTab],
  );
  const closeTabsToLeft = useMemo(() => closeTabsBeside("left"), [closeTabsBeside]);
  const closeTabsToRight = useMemo(() => closeTabsBeside("right"), [closeTabsBeside]);
  const closeOtherTabs = useMemo(() => closeTabsBeside("others"), [closeTabsBeside]);
  const reorderTabs = useCallback(
    (tabPaneId: string, tabIds: string[]) =>
      useWorkspaceLayoutStore.getState().reorderTabsInPane(workspaceKey, tabPaneId, tabIds),
    [workspaceKey],
  );

  const buildPaneContentModel = useCallback(
    ({ tab }: { paneId: string; tab: WorkspaceTabDescriptor }) =>
      buildWorkspacePaneContentModel({
        tab,
        normalizedServerId: scope.serverId,
        normalizedWorkspaceId: scope.workspaceId,
        host: "explorer",
        onOpenTab: onOpenTarget,
        onOpenPreferredTarget: onOpenTarget,
        onCloseCurrentTab: () => closeTab(tab.tabId),
        onRetargetCurrentTab: (target) =>
          useWorkspaceLayoutStore.getState().replaceTab(workspaceKey, tab.tabId, target),
        onSetCurrentTabState: (state) =>
          useWorkspaceLayoutStore.getState().setTabState(workspaceKey, tab.tabId, state),
        onOpenWorkspaceFile: (request) => onOpenTarget({ kind: "file", ...request.location }),
        onOpenImportSheet: noop,
      }),
    [closeTab, onOpenTarget, scope.serverId, scope.workspaceId, workspaceKey],
  );

  if (!pane) return null;
  // These tabs belong to the workspace, not the Desk: no Desk owner lookup, no Move to Desk.
  return (
    <WorkspaceTabOwnerProvider value={null}>
      <WorkspaceTabMoveProvider value={null}>
        {/* Outside the Desk's tab drag: these tabs only reorder within their own row. */}
        <WorkspaceTabDragContext value={NO_DESK_DRAG}>
          <ExplorerSidebarDock
            pane={pane}
            uiTabs={uiTabs}
            normalizedServerId={scope.serverId}
            normalizedWorkspaceId={scope.workspaceId}
            isWorkspaceFocused={isFocused}
            closingTabIds={NO_CLOSING_TABS}
            onSelectTab={selectTab}
            onCloseTab={closeTab}
            hoveredCloseTabKey={hoveredCloseTabKey}
            setHoveredCloseTabKey={setHoveredCloseTabKey}
            onRenameTab={noop}
            onCloseTabsToLeft={closeTabsToLeft}
            onCloseTabsToRight={closeTabsToRight}
            onCloseOtherTabs={closeOtherTabs}
            onExitFocusMode={noop}
            onReorderTabsInPane={reorderTabs}
            buildPaneContentModel={buildPaneContentModel}
            headerAction={renderHeaderAction()}
            {...tabActions}
          />
        </WorkspaceTabDragContext>
      </WorkspaceTabMoveProvider>
    </WorkspaceTabOwnerProvider>
  );
}
