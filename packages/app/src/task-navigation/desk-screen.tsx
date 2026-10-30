// CUSTOM(desks): a cross-workspace split layout rendered by the standard SplitContainer. Tabs,
// tab menus, splits and panels are the workspace screen's; this file only says which workspace
// each tab belongs to and routes layout changes into the Desk store.
import { WorkspaceActions } from "@/git/workspace-actions";
import { WorkspaceOpenInEditorButton } from "@/workspace/open-in-editor/button";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { useNavigateToImportedAgent } from "@/hooks/use-import-session";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostRuntimeClient,
} from "@/runtime/host-runtime";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Pin, Plus, X } from "lucide-react-native";
import type { ListTerminalsResponse } from "@getpaseo/protocol/messages";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { buttonControlHeight } from "@/components/ui/control-geometry";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { ScreenHeader } from "@/components/headers/screen-header";
import { SidebarMenuToggle } from "@/components/headers/sidebar-menu-toggle";
import { HeaderShortcutsRightRow, useHeaderShortcutsRowLayout } from "@/header-shortcuts/layout";
import {
  FloatingPanelPortalHost,
  FloatingPanelPortalHostNameProvider,
} from "@/components/ui/floating-panel-portal";
import { SplitContainer } from "@/components/split-container";
// Upstream 0.14 moved tab drag and drop out of SplitContainer into this scope.
import { WorkspaceTabDragScope } from "@/components/workspace-tab-drag-scope";
import { useToast } from "@/contexts/toast-context";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspace, useWorkspaceDirectory } from "@/stores/session-store-hooks";
import {
  collectAllPanes,
  collectAllTabs,
  findPaneById,
  findPaneContainingTab,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { buildWorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import {
  WorkspaceTabMoveProvider,
  WorkspaceTabOwnerProvider,
  type WorkspaceTabMoveMenu,
  type WorkspaceTabOwnerResolver,
} from "@/screens/workspace/workspace-tab-owner";
import {
  copyTabAgentId,
  copyTabFilePath,
  copyTabResumeCommand,
  copyTabTerminalId,
  createTabFileOpener,
  reloadTabAgent,
} from "@/screens/workspace/workspace-tab-menu-actions";
import {
  useWorkspaceTabRename,
  WorkspaceTabRenameModal,
} from "@/screens/workspace/use-workspace-tab-rename";
import { buildTerminalsQueryKey } from "@/screens/workspace/terminals/state";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useTabLanesStore } from "@/tab-lanes/store";
import { useFlexibleTabMovement } from "@/tab-lanes/settings";
import { getPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import { DiffDocumentWorkspaceCacheProvider } from "@/git/diff-document/workspace-cache";
import { SheetPaneHostProvider, type SheetPaneHost } from "@/screens/workspace/sheet-pane";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import { useDesktopBrowserNewTabRequests } from "@/desktop/browser/new-tab-requests";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { Theme } from "@/styles/theme";
import {
  EXPLORER_TOGGLE_KEYS,
  WorkspaceExplorerSidebarToggle,
  WorkspaceTabRowExplorerToggle,
} from "@/screens/workspace/workspace-explorer-toggle";
import { DeskLauncherProvider } from "./new-tab-menu";
import { DeskExplorerDock, useDeskExplorer } from "./desk-explorer";
import { useCommitMessageFocusStore } from "@/git/commit-selection/focus-request";
import {
  findDiffTabToReuse,
  isInBottomPanel,
  resolveMainContentPaneId,
} from "@/git/diff-tabs/model";
import { useDiffTabsStore } from "@/git/diff-tabs/store";
import { DeskTerminalTabs } from "./desk-terminal-tabs";
import {
  useDesksStore,
  activeDesk,
  activeDeskTab,
  deskContextTab,
  deskTabs,
  type Desk,
  type DeskSplitPosition,
  type DeskTab,
  type DeskTabOwner,
} from "./desks-store";
// CUSTOM(desk-workboard)
import {
  DESK_WORKBOARD_LABEL,
  DeskWorkboardCover,
  useDeskWorkboard,
  useDeskWorkboardStore,
} from "./desk-workboard";
// CUSTOM(bottom-panel-expand)
import { BottomPanelExpandButton } from "@/workspace-tabs/bottom-panel-expand-button";

const NO_CLOSING_TABS = new Set<string>();
const noop = () => undefined;
type DeskNaming = { mode: "create" } | { mode: "rename"; deskId: string };
const ThemedPlus = withUnistyles(Plus);
const ThemedX = withUnistyles(X);
const extraMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundExtraMuted,
});

function workspaceDirectoryOf(owner: DeskTabOwner): string | null {
  return (
    useSessionStore.getState().sessions[owner.serverId]?.workspaces.get(owner.workspaceId)
      ?.workspaceDirectory ?? null
  );
}

function findDeskTab(desk: Desk, matches: (target: WorkspaceTabTarget) => boolean) {
  return deskTabs(desk).find((tab) => matches(tab.target)) ?? null;
}

export function DeskScreen() {
  // CUSTOM(desks): Desks read the panel registry too, and 0.14 registers it in the screen that reads it.
  ensurePanelsRegistered();
  const screenId = useId();
  const portalHost = `desk-floating-panels:${screenId}`;
  const desks = useDesksStore((s) => s.desks);
  const desk = useDesksStore(activeDesk);
  const active = useDesksStore(activeDeskTab);
  const contextTab = useDesksStore(deskContextTab);
  const selection = useActiveWorkspaceSelection();
  const isFocused = useIsFocused();
  const toast = useToast();
  const { t } = useTranslation();
  const localServerId = useLocalDaemonServerId();
  const [hydrated, setHydrated] = useState(useDesksStore.persist.hasHydrated());
  const [naming, setNaming] = useState<DeskNaming | null>(null);
  // CUSTOM(desk-workboard)
  const {
    plugin: workboard,
    open: workboardOpen,
    selected: workboardSelected,
  } = useDeskWorkboard(desk.id, active);
  const [hoveredCloseTabKey, setHoveredCloseTabKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{
    tab: WorkspaceTabDescriptor;
    owner: DeskTabOwner;
  } | null>(null);
  const [importOwner, setImportOwner] = useState<DeskTabOwner | null>(null);
  const [fileRevisions, setFileRevisions] = useState<Record<string, number>>({});
  const onRowLayout = useHeaderShortcutsRowLayout(screenId);
  useEffect(() => useDesksStore.persist.onFinishHydration(() => setHydrated(true)), []);
  useEffect(() => {
    if (!hydrated || !selection) return;
    const layout =
      useWorkspaceLayoutStore.getState().layoutByWorkspace[
        `${selection.serverId}:${selection.workspaceId}`
      ];
    const pane = layout ? findPaneById(layout.root, layout.focusedPaneId) : null;
    const tab = layout
      ? collectAllTabs(layout.root).find((entry) => entry.tabId === pane?.focusedTabId)
      : null;
    useDesksStore
      .getState()
      .initialize(
        tab && tab.target.kind !== "new_tab"
          ? { ...selection, target: tab.target, state: tab.state }
          : undefined,
      );
  }, [hydrated, selection]);

  // The scope is the focused tab's workspace: launches, the bottom panel's first terminal and unowned
  // new-tab launchers use it.
  const scopeServerId = active?.serverId ?? selection?.serverId ?? null;
  const scopeWorkspaceId = active?.workspaceId ?? selection?.workspaceId ?? null;
  const scope = useMemo<DeskTabOwner | null>(
    () =>
      scopeServerId && scopeWorkspaceId
        ? { serverId: scopeServerId, workspaceId: scopeWorkspaceId }
        : null,
    [scopeServerId, scopeWorkspaceId],
  );
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const owners = desk.owners;
  const previewTabId = desk.previewTabId;
  const resolveOwner = useCallback<WorkspaceTabOwnerResolver>(
    (tabId) => {
      const owner = owners[tabId] ?? scope;
      return owner ? { ...owner, preview: tabId === previewTabId } : null;
    },
    [owners, previewTabId, scope],
  );
  const focusedDeskTabId = findPaneById(desk.layout.root, desk.layout.focusedPaneId)?.focusedTabId;
  const { explorerScope, explorerTabId } = useDeskExplorerTarget(
    contextTab,
    scope,
    focusedDeskTabId,
  );
  const explorer = useDeskExplorer(explorerScope, explorerTabId);
  const resolveOwnerRef = useRef(resolveOwner);
  resolveOwnerRef.current = resolveOwner;
  const ownerOf = useCallback((tabId: string) => resolveOwnerRef.current(tabId), []);

  const closeTabs = useCallback(
    async (tabIds: string[]) => {
      const modified = tabIds.filter((tabId) => {
        const owner = ownerOf(tabId);
        return owner && getPanelInstanceAttributes({ ...owner, tabId }).modified;
      });
      if (modified.length > 0) {
        const confirmed = await confirmDialog({
          title: t("workspace.tabs.confirmations.unsavedTitle"),
          message: t("workspace.tabs.confirmations.unsavedMessage"),
          confirmLabel: t("workspace.tabs.confirmations.closeWithoutSaving"),
          cancelLabel: t("workspace.tabs.confirmations.cancel"),
          destructive: true,
        });
        if (!confirmed) return;
      }
      // Closing a Desk tab drops its reference; the agent and workspace stay untouched.
      for (const tabId of tabIds) useDesksStore.getState().closeTab(tabId);
    },
    [ownerOf, t],
  );
  const closeTab = useCallback((tabId: string) => closeTabs([tabId]), [closeTabs]);

  useKeyboardActionHandler({
    handlerId: `desk-tab-actions:${screenId}`,
    enabled: isFocused,
    priority: 200,
    actions: [
      "workspace.tab.close-current",
      // CUSTOM(workspace-rename-f2)
      "workspace.tab.rename-current",
      "workspace.tab.navigate-index",
      "workspace.tab.navigate-relative",
      "workspace.pane.split.right",
      "workspace.pane.split.down",
      "task.desk.next",
      "task.desk.new",
    ],
    handle: (action) => {
      const store = useDesksStore.getState();
      const current = activeDesk(store);
      const pane = findPaneById(current.layout.root, current.layout.focusedPaneId);
      const tabIds = pane?.tabIds ?? [];
      const currentTabId = pane?.focusedTabId ?? null;
      if (action.id === "task.desk.new") {
        setNaming({ mode: "create" });
        return true;
      }
      if (action.id === "task.desk.next") {
        const index = store.desks.findIndex((d) => d.id === current.id);
        store.selectDesk(store.desks[(index + 1) % store.desks.length]!.id);
        return true;
      }
      if (action.id === "workspace.pane.split.right" || action.id === "workspace.pane.split.down") {
        if (pane) {
          store.splitPaneEmpty(
            {
              targetPaneId: pane.id,
              position: action.id === "workspace.pane.split.right" ? "right" : "bottom",
            },
            scopeRef.current,
          );
        }
        return true;
      }
      if (action.id === "workspace.tab.close-current") {
        if (currentTabId) void closeTab(currentTabId);
        return true;
      }
      if (action.id === "workspace.tab.rename-current") {
        const tab = collectAllTabs(current.layout.root).find(
          (entry) => entry.tabId === currentTabId,
        );
        if (tab) {
          renameTab({
            key: tab.tabId,
            tabId: tab.tabId,
            kind: tab.target.kind,
            target: tab.target,
          });
        }
        return true;
      }
      if (action.id === "workspace.tab.navigate-index") {
        const tabId = tabIds[action.index === 9 ? tabIds.length - 1 : action.index - 1];
        if (tabId) store.selectTab(tabId);
        return true;
      }
      if (action.id === "workspace.tab.navigate-relative") {
        const index = tabIds.findIndex((tabId) => tabId === currentTabId);
        const tabId = tabIds[(index + action.delta + tabIds.length) % tabIds.length];
        if (tabId) store.selectTab(tabId);
        return true;
      }
      return false;
    },
  });

  // CUSTOM(desk-explorer): Ctrl/Cmd+E toggles the focused task's Explorer.
  useKeyboardActionHandler({
    handlerId: `desk-explorer-actions:${screenId}`,
    enabled: isFocused,
    priority: 100,
    actions: ["sidebar.toggle.right"],
    handle: () => {
      // CUSTOM(commit-selection): opening the Explorer also focuses the Changes commit message.
      if (!explorer.isOpen) useCommitMessageFocusStore.getState().request();
      explorer.toggle();
      return true;
    },
  });

  const closeTabsBeside = useCallback(
    (side: "left" | "right" | "others") => (tabId: string, paneTabs: WorkspaceTabDescriptor[]) => {
      const index = paneTabs.findIndex((tab) => tab.tabId === tabId);
      if (index < 0) return;
      let closing = paneTabs.filter((tab) => tab.tabId !== tabId);
      if (side === "left") closing = paneTabs.slice(0, index);
      if (side === "right") closing = paneTabs.slice(index + 1);
      return closeTabs(closing.map((tab) => tab.tabId));
    },
    [closeTabs],
  );
  const closeTabsToLeft = useMemo(() => closeTabsBeside("left"), [closeTabsBeside]);
  const closeTabsToRight = useMemo(() => closeTabsBeside("right"), [closeTabsBeside]);
  const closeOtherTabs = useMemo(() => closeTabsBeside("others"), [closeTabsBeside]);

  const agentOwner = useCallback(
    (agentId: string): DeskTabOwner | null =>
      findDeskTab(
        activeDesk(useDesksStore.getState()),
        (target) => target.kind === "agent" && target.agentId === agentId,
      ) ?? scopeRef.current,
    [],
  );
  const copyAgentId = useCallback(
    (agentId: string) => copyTabAgentId(agentId, { toast, t }),
    [toast, t],
  );
  const copyTerminalId = useCallback(
    (terminalId: string) => copyTabTerminalId(terminalId, { toast, t }),
    [toast, t],
  );
  const copyResumeCommand = useCallback(
    (agentId: string) => {
      const owner = agentOwner(agentId);
      if (owner)
        void copyTabResumeCommand({
          serverId: owner.serverId,
          agentId,
          toast,
          t,
        });
    },
    [agentOwner, toast, t],
  );
  const reloadAgent = useCallback(
    (agentId: string) => {
      const owner = agentOwner(agentId);
      if (!owner) return;
      const snapshot = getHostRuntimeStore().getSnapshot(owner.serverId);
      void reloadTabAgent({
        client: snapshot?.client ?? null,
        isConnected: isHostRuntimeConnected(snapshot),
        serverId: owner.serverId,
        agentId,
        toast,
        t,
      });
    },
    [agentOwner, toast, t],
  );
  const copyFilePath = useCallback(
    (path: string, mode?: "full", tabId?: string) => {
      const owner = tabId ? ownerOf(tabId) : scopeRef.current;
      void copyTabFilePath({
        path,
        mode,
        serverId: owner?.serverId,
        workspaceDirectory: owner ? workspaceDirectoryOf(owner) : null,
        toast,
        t,
      });
    },
    [ownerOf, toast, t],
  );
  // CUSTOM(open-file-externally): never hand a remote host's paths to the local OS.
  const openFile = useMemo(() => {
    if (!localServerId || !createTabFileOpener(true)) return undefined;
    return (path: string, mode: "browser" | "default", tabId?: string) => {
      const owner = tabId ? ownerOf(tabId) : scopeRef.current;
      const opener = createTabFileOpener(owner?.serverId === localServerId);
      if (!owner || !opener) {
        toast.error("Files on a remote host cannot be opened locally");
        return;
      }
      void opener({
        path,
        mode,
        serverId: owner.serverId,
        workspaceDirectory: workspaceDirectoryOf(owner),
        toast,
        t,
      });
    };
  }, [localServerId, ownerOf, toast, t]);
  const renameTab = useCallback(
    (tab: WorkspaceTabDescriptor) => {
      const owner = ownerOf(tab.tabId);
      if (owner) setRenaming({ tab, owner });
    },
    [ownerOf],
  );

  const openInDesk = useCallback(
    (owner: DeskTabOwner, target: WorkspaceTabTarget, paneId?: string) => {
      // CUSTOM(changes-diff-tab): a Changes file click scrolls this workspace's open diff tab.
      const deskNow = activeDesk(useDesksStore.getState());
      const diffTab = findDiffTabToReuse({
        tabs: deskTabs(deskNow).filter(
          (tab) =>
            tab.serverId === owner.serverId &&
            tab.workspaceId === owner.workspaceId &&
            // CUSTOM(changes-main-content): a diff tab in the bottom panel is not reused.
            !isInBottomPanel(deskNow.layout.root, tab.id),
        ),
        target,
        openInNewTabs: useDiffTabsStore.getState().openInNewTabs,
      });
      if (diffTab) {
        useDesksStore.getState().updateTab(diffTab.id, { target });
        useDesksStore.getState().selectTab(diffTab.id);
        return;
      }
      useDesksStore
        .getState()
        .openTab(
          { serverId: owner.serverId, workspaceId: owner.workspaceId, target },
          true,
          paneId ? { mode: "prefer", paneId } : undefined,
        );
      const opened = activeDeskTab(useDesksStore.getState());
      if (target.kind === "file" && opened) {
        setFileRevisions((current) => ({
          ...current,
          [opened.id]: (current[opened.id] ?? 0) + 1,
        }));
      }
    },
    [],
  );
  // CUSTOM(changes-main-content): Explorer clicks open in the Explorer's workspace (the context
  // agent tab's, not a focused bottom panel terminal's) and in its pane, never the bottom panel.
  const explorerTargetRef = useRef({ explorerScope, explorerTabId });
  explorerTargetRef.current = { explorerScope, explorerTabId };
  const openFromExplorer = useCallback(
    (target: WorkspaceTabTarget) => {
      const owner = explorerTargetRef.current.explorerScope ?? scopeRef.current;
      if (!owner) return;
      const paneId = resolveMainContentPaneId(
        activeDesk(useDesksStore.getState()).layout,
        explorerTargetRef.current.explorerTabId,
      );
      openInDesk(owner, target, paneId);
    },
    [openInDesk],
  );

  const buildPaneContentModel = useCallback(
    ({
      paneId,
      tab,
      host = "main",
      onCloseCurrentTab,
    }: {
      paneId: string | null;
      tab: WorkspaceTabDescriptor;
      host?: "main" | "sheet";
      onCloseCurrentTab?: () => void;
    }) => {
      const owner = resolveOwner(tab.tabId) ?? {
        serverId: "",
        workspaceId: "",
      };
      const open = (target: WorkspaceTabTarget) => openInDesk(owner, target, paneId ?? undefined);
      return buildWorkspacePaneContentModel({
        tab,
        normalizedServerId: owner.serverId,
        normalizedWorkspaceId: owner.workspaceId,
        host,
        panelRevision: fileRevisions[tab.tabId] ?? 0,
        onOpenTab: open,
        onOpenPreferredTarget: open,
        onCloseCurrentTab: onCloseCurrentTab ?? (() => void closeTab(tab.tabId)),
        onRetargetCurrentTab: (target) =>
          useDesksStore.getState().updateTab(tab.tabId, {
            serverId: owner.serverId,
            workspaceId: owner.workspaceId,
            target,
          }),
        onSetCurrentTabState: (state) => useDesksStore.getState().updateTab(tab.tabId, { state }),
        onOpenWorkspaceFile: (request) => open({ kind: "file", ...request.location }),
        onOpenImportSheet: () =>
          setImportOwner({
            serverId: owner.serverId,
            workspaceId: owner.workspaceId,
          }),
      });
    },
    [resolveOwner, fileRevisions, closeTab, openInDesk],
  );

  // CUSTOM(desks): 0.14 panels (subagents, sheets) need the workspace's sheet host; a Desk lends
  // them the focused tab's workspace, like the scope.
  const sheetPaneHost = useMemo<SheetPaneHost | null>(
    () =>
      scope
        ? {
            workspaceKey: `${scope.serverId}:${scope.workspaceId}`,
            serverId: scope.serverId,
            workspaceId: scope.workspaceId,
            isWorkspaceFocused: isFocused,
            buildContent: (tab, closeCurrentTab) =>
              buildPaneContentModel({
                tab,
                paneId: null,
                host: "sheet",
                onCloseCurrentTab: closeCurrentTab,
              }),
          }
        : null,
    [buildPaneContentModel, isFocused, scope],
  );

  const createNewTab = useCallback(
    ({ paneId }: { paneId?: string }) =>
      useDesksStore.getState().createNewTab(scopeRef.current, paneId),
    [],
  );
  const splitPaneEmpty = useCallback(
    (input: { targetPaneId: string; position: DeskSplitPosition }) => {
      const layout = activeDesk(useDesksStore.getState()).layout;
      const tabId = findPaneById(layout.root, input.targetPaneId)?.focusedTabId;
      const owner = (tabId ? ownerOf(tabId) : null) ?? scopeRef.current;
      useDesksStore
        .getState()
        .splitPaneEmpty(
          input,
          owner ? { serverId: owner.serverId, workspaceId: owner.workspaceId } : null,
        );
    },
    [ownerOf],
  );

  useDesktopBrowserNewTabRequests({
    enabled: isFocused,
    workspaceLayout: desk.layout,
    openUrl: (url, request) => {
      const current = activeDesk(useDesksStore.getState());
      const source = findDeskTab(
        current,
        (target) => target.kind === "browser" && target.browserId === request.sourceBrowserId,
      );
      const owner = source ?? scopeRef.current;
      if (!owner) return;
      const paneId = source ? findPaneContainingTab(current.layout.root, source.id)?.id : undefined;
      const { browserId } = createWorkspaceBrowser({ initialUrl: url });
      useDesksStore.getState().openTab(
        {
          serverId: owner.serverId,
          workspaceId: owner.workspaceId,
          target: { kind: "browser", browserId },
        },
        true,
        paneId ? { mode: "pane", paneId } : undefined,
      );
    },
  });

  const closeNaming = useCallback(() => setNaming(null), []);
  const create = useCallback(() => setNaming({ mode: "create" }), []);
  const renameDesk = useCallback((deskId: string) => setNaming({ mode: "rename", deskId }), []);
  const deleteDesk = useCallback(async (entry: Desk) => {
    const confirmed = await confirmDialog({
      title: `Delete "${entry.name}"?`,
      message: "Its tabs leave this Desk. The agents and workspaces stay as they are.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (confirmed) useDesksStore.getState().deleteDesk(entry.id);
  }, []);
  const submitName = useCallback(
    (name: string) => {
      if (naming?.mode === "rename") useDesksStore.getState().renameDesk(naming.deskId, name);
      else useDesksStore.getState().createDesk(name);
    },
    [naming],
  );
  const closeRename = useCallback(() => setRenaming(null), []);
  const closeImport = useCallback(() => setImportOwner(null), []);
  const keep = useDesksStore((s) => s.keepPreview);
  const activeIsPreview = Boolean(active && active.id === previewTabId);
  const uiTabs = useMemo(() => collectAllTabs(desk.layout.root), [desk.layout.root]);
  const flexibleTabs = useFlexibleTabMovement().enabled; // CUSTOM(flexible-tabs)
  // CUSTOM(tab-lanes): forget the spots of closed tabs.
  useEffect(() => {
    if (uiTabs.length === 0) return;
    useTabLanesStore.getState().retain(`desk:${desk.id}`, new Set(uiTabs.map((tab) => tab.tabId)));
  }, [desk.id, uiTabs]);

  const headerLeft = useMemo(
    () => (
      <View style={styles.headerLeft}>
        <SidebarMenuToggle />
        {/* CUSTOM(desk-header): no project name (every tab shows its project's icon), and the
          New Desk + sits before the Desks so it isn't mistaken for the tab row's +. */}
        <View style={styles.deskTabs}>
          {workboard && !workboardOpen ? (
            <DeskCreateMenu onCreateDesk={create} />
          ) : (
            <ToolbarButton
              label="New Desk"
              onPress={create}
              style={styles.newDeskButton}
              testID="desk-create"
            >
              <ThemedPlus size={14} uniProps={extraMutedColorMapping} />
            </ToolbarButton>
          )}
          <View style={styles.newDeskDivider} />
          {workboardOpen ? <DeskWorkboardChip selected={workboardSelected} /> : null}
          {desks.map((entry) => (
            <DeskTabChip
              key={entry.id}
              desk={entry}
              selected={entry.id === desk.id && !workboardSelected}
              canDelete={desks.length > 1}
              onRename={renameDesk}
              onDelete={deleteDesk}
            />
          ))}
        </View>
        {activeIsPreview && !workboardSelected ? (
          <Button
            variant="ghost"
            size="xs"
            leftIcon={Pin}
            onPress={keep}
            testID="desk-keep-preview"
          >
            Keep tab
          </Button>
        ) : null}
      </View>
    ),
    [
      activeIsPreview,
      create,
      deleteDesk,
      desk.id,
      desks,
      keep,
      renameDesk,
      workboard,
      workboardOpen,
      workboardSelected,
    ],
  );
  const explorerToggleProps = useMemo(
    () => ({
      owner: explorer.toggleOwner,
      onPress: explorer.toggle,
      label: explorer.isOpen
        ? t("workspace.tabs.explorerSidebar.close")
        : t("workspace.tabs.explorerSidebar.open"),
      tooltipLabel: t("workspace.tabs.explorerSidebar.toggle"),
      tooltipKeys: EXPLORER_TOGGLE_KEYS,
      accessibilityState: { expanded: explorer.isOpen },
    }),
    [explorer.isOpen, explorer.toggle, explorer.toggleOwner, t],
  );
  const headerRight = useMemo(
    () => (
      <HeaderShortcutsRightRow layoutKey={screenId} style={styles.headerLeft}>
        {contextTab ? <DeskWorkspaceActions tab={contextTab} focused={active} /> : null}
      </HeaderShortcutsRightRow>
    ),
    [active, contextTab, screenId],
  );
  // CUSTOM(explorer-toggle-tab-row): the Explorer toggle sits in the top-right pane's tab row.
  const renderTabRowExplorerToggle = useCallback(
    () => (explorerScope ? <WorkspaceTabRowExplorerToggle {...explorerToggleProps} /> : null),
    [explorerToggleProps, explorerScope],
  );
  const renderExplorerHeaderToggle = useCallback(
    () => <WorkspaceExplorerSidebarToggle {...explorerToggleProps} />,
    [explorerToggleProps],
  );
  const explorerWorkspaceKey = explorer.workspaceKey;
  const createNewTabFromExplorer = useCallback(() => createNewTab({}), [createNewTab]);
  const externalExplorerSidebar = useMemo(
    () =>
      explorerScope && explorerWorkspaceKey && explorer.isOpen
        ? {
            workspaceKey: explorerWorkspaceKey,
            render: () => (
              <DeskExplorerDock
                scope={explorerScope}
                workspaceKey={explorerWorkspaceKey}
                isFocused={isFocused}
                renderHeaderAction={renderExplorerHeaderToggle}
                onOpenTarget={openFromExplorer}
                onCopyResumeCommand={copyResumeCommand}
                onCopyAgentId={copyAgentId}
                onCopyTerminalId={copyTerminalId}
                onCopyFilePath={copyFilePath}
                onOpenFile={openFile}
                onReloadAgent={reloadAgent}
                onCreateNewTab={createNewTabFromExplorer}
              />
            ),
          }
        : null,
    [
      copyAgentId,
      copyFilePath,
      copyResumeCommand,
      copyTerminalId,
      createNewTabFromExplorer,
      explorer.isOpen,
      renderExplorerHeaderToggle,
      explorerScope,
      explorerWorkspaceKey,
      isFocused,
      openFile,
      openFromExplorer,
      reloadAgent,
    ],
  );
  const renderHeader = useCallback(
    () => <ScreenHeader onRowLayout={onRowLayout} left={headerLeft} right={headerRight} />,
    [headerLeft, headerRight, onRowLayout],
  );

  // CUSTOM(desk-tab-move): the tab context menu moves a tab to any other Desk.
  const moveMenu = useMemo<WorkspaceTabMoveMenu>(
    () => ({
      targets: desks
        .filter((entry) => entry.id !== desk.id)
        .map((entry) => ({ id: entry.id, label: entry.name })),
      move: (tabId, deskId) => useDesksStore.getState().moveTabToDesk(tabId, deskId),
    }),
    [desks, desk.id],
  );

  const store = useDesksStore.getState();
  return (
    <FloatingPanelPortalHostNameProvider hostName={portalHost}>
      <View style={styles.root} testID="desk-screen">
        {/* CUSTOM(desk-workboard): the board covers the Desk, which stays mounted underneath. */}
        <DeskWorkboardCover plugin={workboardSelected ? workboard : null} headerLeft={headerLeft}>
          {scope ? (
            <DeskProviders
              resolveOwner={resolveOwner}
              moveMenu={moveMenu}
              scope={scope}
              enabled={isFocused}
              sheetPaneHost={sheetPaneHost}
            >
              <WorkspaceTabDragScope
                layout={desk.layout}
                explorerSidebarPaneId={null}
                allowCrossPane
                normalizedServerId={scope.serverId}
                normalizedWorkspaceId={scope.workspaceId}
                uiTabs={uiTabs}
                onMoveTabToPane={store.moveTabToPane}
                onReorderTabsInPane={store.reorderTabsInPane}
                onSplitPane={store.splitPane}
                laneScope={flexibleTabs ? `desk:${desk.id}` : null} // CUSTOM(tab-lanes)
              >
                <SplitContainer
                  tabLanes={flexibleTabs} // CUSTOM(tab-lanes), CUSTOM(flexible-tabs)
                  layout={desk.layout}
                  renderMainHeader={renderHeader}
                  externalExplorerSidebar={externalExplorerSidebar}
                  renderTopRightTabRowAction={renderTabRowExplorerToggle}
                  workspaceKey={`desk:${desk.id}`}
                  normalizedServerId={scope.serverId}
                  normalizedWorkspaceId={scope.workspaceId}
                  isWorkspaceFocused={isFocused}
                  uiTabs={uiTabs}
                  hoveredCloseTabKey={hoveredCloseTabKey}
                  setHoveredCloseTabKey={setHoveredCloseTabKey}
                  closingTabIds={NO_CLOSING_TABS}
                  onNavigateTab={store.selectTab}
                  onCloseTab={closeTab}
                  onCopyResumeCommand={copyResumeCommand}
                  onCopyAgentId={copyAgentId}
                  onCopyTerminalId={copyTerminalId}
                  onCopyFilePath={copyFilePath}
                  onOpenFile={openFile}
                  onReloadAgent={reloadAgent}
                  onRenameTab={renameTab}
                  onCloseTabsToLeft={closeTabsToLeft}
                  onCloseTabsToRight={closeTabsToRight}
                  onCloseOtherTabs={closeOtherTabs}
                  onCreateNewTab={createNewTab}
                  buildPaneContentModel={buildPaneContentModel}
                  onFocusPane={store.focusPane}
                  onSplitPane={store.splitPane}
                  onSplitPaneEmpty={splitPaneEmpty}
                  onMoveTabToPane={store.moveTabToPane}
                  onSelectTabInPane={store.selectTabInPane}
                  onResizeSplit={store.resizeSplit}
                  onReorderTabsInPane={store.reorderTabsInPane}
                  onExitFocusMode={noop}
                />
              </WorkspaceTabDragScope>
            </DeskProviders>
          ) : (
            <>
              {renderHeader()}
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>{desk.name}</Text>
                <Text style={styles.context}>
                  Click a task to preview it. Middle-click to keep it as a tab.
                </Text>
              </View>
            </>
          )}
          {/* CUSTOM(bottom-panel-expand): ⌃⌃ while the Desk's bottom panel is closed; the toggle
            needs a scope. */}
          {scope ? <BottomPanelExpandButton layout={desk.layout} /> : null}
        </DeskWorkboardCover>
        <DeskVisibleAgents desk={desk} visible={isFocused} covered={workboardSelected} />
        <DeskTerminalTabs />
        <FloatingPanelPortalHost name={portalHost} />
        <DeskNameModal naming={naming} desks={desks} onClose={closeNaming} onSubmit={submitName} />
        {renaming ? (
          <DeskTabRename
            key={renaming.tab.tabId}
            tab={renaming.tab}
            owner={renaming.owner}
            onClose={closeRename}
          />
        ) : null}
        {importOwner ? (
          <DeskImportSheet
            key={`${importOwner.serverId}:${importOwner.workspaceId}`}
            owner={importOwner}
            visible={isFocused}
            onClose={closeImport}
          />
        ) : null}
      </View>
    </FloatingPanelPortalHostNameProvider>
  );
}

/** Desk tabs resolve their own workspace; launches use the scope workspace. */
function DeskProviders({
  resolveOwner,
  moveMenu,
  scope,
  enabled,
  sheetPaneHost,
  children,
}: {
  resolveOwner: WorkspaceTabOwnerResolver;
  moveMenu: WorkspaceTabMoveMenu;
  scope: DeskTabOwner;
  enabled: boolean;
  sheetPaneHost: SheetPaneHost | null;
  children: ReactNode;
}) {
  return (
    <WorkspaceTabOwnerProvider value={resolveOwner}>
      <WorkspaceTabMoveProvider value={moveMenu}>
        <DeskLauncherProvider scope={scope} enabled={enabled}>
          <DiffDocumentWorkspaceCacheProvider>
            <SheetPaneHostProvider value={sheetPaneHost}>
              <View style={styles.content}>{children}</View>
            </SheetPaneHostProvider>
          </DiffDocumentWorkspaceCacheProvider>
        </DeskLauncherProvider>
      </WorkspaceTabMoveProvider>
    </WorkspaceTabOwnerProvider>
  );
}

/** Marks each pane's visible agent as viewed, on whichever host it lives. */
function DeskVisibleAgents({
  desk,
  visible: focused,
  covered,
}: {
  desk: Desk;
  visible: boolean;
  /** CUSTOM(desk-workboard): the board covers the Desk. */
  covered: boolean;
}) {
  const visible = focused && !covered;
  const syncOwner = useId();
  // A string key, so streamed session updates do not re-run the effect.
  const syncedServers = useSessionStore((s) =>
    Object.keys(s.sessions)
      .filter((serverId) => s.sessions[serverId]?.viewedTimelineSync)
      .join("\n"),
  );
  useEffect(() => {
    const owner = `desk:${syncOwner}`;
    const byServer = new Map<string, string[]>();
    if (visible) {
      const tabs = new Map(deskTabs(desk).map((tab) => [tab.id, tab]));
      for (const pane of collectAllPanes(desk.layout.root)) {
        const tab = pane.hidden || !pane.focusedTabId ? null : tabs.get(pane.focusedTabId);
        let agentId: string | null = null;
        if (tab?.target.kind === "agent") agentId = tab.target.agentId;
        if (tab?.target.kind === "provider_subagent") agentId = tab.target.parentAgentId;
        if (tab && agentId) {
          byServer.set(tab.serverId, [...(byServer.get(tab.serverId) ?? []), agentId]);
        }
      }
    }
    const sessions = useSessionStore.getState().sessions;
    const syncs = syncedServers.split("\n").flatMap((serverId) => {
      const sync = sessions[serverId]?.viewedTimelineSync;
      return sync ? [[serverId, sync] as const] : [];
    });
    for (const [serverId, sync] of syncs) {
      sync.replaceVisibleAgentIds(owner, byServer.get(serverId) ?? []);
    }
    return () => {
      for (const [, sync] of syncs) sync.replaceVisibleAgentIds(owner, []);
    };
  }, [desk, visible, syncedServers, syncOwner]);
  return null;
}

function DeskTabRename({
  tab,
  owner,
  onClose,
}: {
  tab: WorkspaceTabDescriptor;
  owner: DeskTabOwner;
  onClose: () => void;
}) {
  const client = useHostRuntimeClient(owner.serverId);
  const directory = useWorkspaceDirectory(owner.serverId, owner.workspaceId);
  const queryClient = useQueryClient();
  const terminalsQueryKey = useMemo(
    () => buildTerminalsQueryKey(owner.serverId, directory, owner.workspaceId),
    [owner.serverId, owner.workspaceId, directory],
  );
  const rename = useWorkspaceTabRename({
    client,
    normalizedServerId: owner.serverId,
    queryClient,
    terminalsData: queryClient.getQueryData<ListTerminalsResponse["payload"]>(terminalsQueryKey),
    terminalsQueryKey,
  });
  const { handleRenameTab, handleRenameModalClose } = rename;
  useEffect(() => handleRenameTab(tab), [handleRenameTab, tab]);
  const close = useCallback(() => {
    handleRenameModalClose();
    onClose();
  }, [handleRenameModalClose, onClose]);
  return (
    <WorkspaceTabRenameModal
      renamingTab={rename.renamingTab}
      onClose={close}
      onSubmit={rename.handleRenameModalSubmit}
    />
  );
}

function DeskImportSheet({
  owner,
  visible,
  onClose,
}: {
  owner: DeskTabOwner;
  visible: boolean;
  onClose: () => void;
}) {
  const client = useHostRuntimeClient(owner.serverId);
  const directory = useWorkspaceDirectory(owner.serverId, owner.workspaceId);
  const navigateToImportedAgent = useNavigateToImportedAgent(owner.serverId);
  const importedHere = useCallback(
    (agentId: string) =>
      useDesksStore.getState().openTab({ ...owner, target: { kind: "agent", agentId } }, true),
    [owner],
  );
  return (
    <ImportSessionSheet
      visible={visible}
      client={client}
      serverId={owner.serverId}
      cwd={directory}
      workspaceId={owner.workspaceId}
      onClose={onClose}
      onImportedAgent={importedHere}
      onImported={navigateToImportedAgent}
    />
  );
}

/**
 * CUSTOM(desk-context-tab): the Explorer follows the last focused agent tab, not a terminal or
 * browser that happens to have focus (a bottom panel's tabs can belong to another project).
 */
function useDeskExplorerTarget(
  contextTab: DeskTab | null,
  scope: DeskTabOwner | null,
  focusedTabId: string | null | undefined,
): { explorerScope: DeskTabOwner | null; explorerTabId: string | null } {
  const serverId = contextTab?.serverId ?? scope?.serverId;
  const workspaceId = contextTab?.workspaceId ?? scope?.workspaceId;
  const explorerScope = useMemo<DeskTabOwner | null>(
    () => (serverId && workspaceId ? { serverId, workspaceId } : null),
    [serverId, workspaceId],
  );
  return {
    explorerScope,
    explorerTabId: contextTab?.id ?? focusedTabId ?? null,
  };
}
/** `tab` is the context tab; the focused tab's file opens in the editor when it is in that workspace. */
function DeskWorkspaceActions({ tab, focused }: { tab: DeskTab; focused: DeskTab | null }) {
  const directory = useWorkspaceDirectory(tab.serverId, tab.workspaceId);
  const workspace = useWorkspace(tab.serverId, tab.workspaceId);
  if (!directory) return null;
  const sameWorkspace =
    focused?.serverId === tab.serverId && focused.workspaceId === tab.workspaceId;
  return (
    <>
      <WorkspaceOpenInEditorButton
        serverId={tab.serverId}
        cwd={directory}
        projectId={workspace?.projectId ?? null}
        activeFile={sameWorkspace && focused.target.kind === "file" ? focused.target : null}
        hideLabels
      />
      <WorkspaceActions serverId={tab.serverId} cwd={directory} />
    </>
  );
}
function DeskNameModal({
  naming,
  desks,
  onClose,
  onSubmit,
}: {
  naming: DeskNaming | null;
  desks: Desk[];
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const renaming = naming?.mode === "rename";
  const renamingDesk =
    naming?.mode === "rename" ? desks.find((entry) => entry.id === naming.deskId) : undefined;
  return (
    <AdaptiveRenameModal
      visible={naming !== null}
      title={renaming ? "Rename Desk" : "New Desk"}
      initialValue={renamingDesk?.name ?? ""}
      placeholder="e.g. While waiting"
      submitLabel={renaming ? "Save" : "Create Desk"}
      onClose={onClose}
      onSubmit={onSubmit}
      testID="desk-name-modal"
    />
  );
}

/** A Desk tab: selects the Desk on press; right-click renames or deletes it. */
function DeskTabChip({
  desk,
  selected,
  canDelete,
  onRename,
  onDelete,
}: {
  desk: Desk;
  selected: boolean;
  canDelete: boolean;
  onRename: (deskId: string) => void;
  onDelete: (desk: Desk) => void;
}) {
  const select = useCallback(() => {
    useDeskWorkboardStore.getState().deselect(); // CUSTOM(desk-workboard)
    useDesksStore.getState().selectDesk(desk.id);
  }, [desk.id]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const rename = useCallback(() => onRename(desk.id), [onRename, desk.id]);
  const remove = useCallback(() => onDelete(desk), [onDelete, desk]);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        testID={`desk-choice-${desk.id}`}
        accessibilityRole="button"
        accessibilityLabel={desk.name}
        accessibilityState={accessibilityState}
        aria-selected={selected}
        style={[styles.deskTab, selected && styles.deskTabSelected]}
        onPress={select}
      >
        <Text
          style={[styles.deskTabText, selected && styles.deskTabTextSelected]}
          numberOfLines={1}
        >
          {desk.name}
        </Text>
      </ContextMenuTrigger>
      <ContextMenuContent align="start">
        <ContextMenuItem testID={`desk-rename-${desk.id}`} onSelect={rename}>
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          testID={`desk-delete-${desk.id}`}
          destructive
          disabled={!canDelete}
          onSelect={remove}
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
/** CUSTOM(desk-workboard): the board's tab; × or right-click > Close moves it into +. */
function DeskWorkboardChip({ selected }: { selected: boolean }) {
  const select = useCallback(() => useDeskWorkboardStore.getState().select(), []);
  const close = useCallback(() => useDeskWorkboardStore.getState().close(), []);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <ContextMenu>
      <View style={[styles.workboardTab, selected && styles.deskTabSelected]}>
        <ContextMenuTrigger
          testID="desk-workboard-choice"
          accessibilityRole="button"
          accessibilityLabel={DESK_WORKBOARD_LABEL}
          accessibilityState={accessibilityState}
          aria-selected={selected}
          style={styles.workboardTabLabel}
          onPress={select}
        >
          <Text
            style={[styles.deskTabText, selected && styles.deskTabTextSelected]}
            numberOfLines={1}
          >
            {DESK_WORKBOARD_LABEL}
          </Text>
        </ContextMenuTrigger>
        <ToolbarButton
          label={`Close ${DESK_WORKBOARD_LABEL}`}
          onPress={close}
          style={styles.workboardClose}
          testID="desk-workboard-close"
        >
          <ThemedX size={12} uniProps={extraMutedColorMapping} />
        </ToolbarButton>
      </View>
      <ContextMenuContent align="start">
        <ContextMenuItem testID="desk-workboard-close-menu" onSelect={close}>
          Close
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** CUSTOM(desk-workboard): + while the board is closed: a new Desk or the board again. */
function DeskCreateMenu({ onCreateDesk }: { onCreateDesk: () => void }) {
  const reopen = useCallback(() => useDeskWorkboardStore.getState().reopen(), []);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID="desk-create"
        accessibilityRole="button"
        accessibilityLabel="New Desk or Power Workboard"
        style={styles.newDeskMenuTrigger}
      >
        <ThemedPlus size={14} uniProps={extraMutedColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" width={200} testID="desk-create-menu">
        <DropdownMenuItem testID="desk-create-desk" onSelect={onCreateDesk}>
          New Desk
        </DropdownMenuItem>
        <DropdownMenuItem testID="desk-create-workboard" onSelect={reopen}>
          {DESK_WORKBOARD_LABEL}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  context: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  deskTabs: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
  },
  deskTab: {
    height: buttonControlHeight.xs,
    maxWidth: 200,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    justifyContent: "center",
  },
  // CUSTOM(desk-header): a soft green, so the selected Desk doesn't read as a selected tab.
  deskTabSelected: {
    backgroundColor:
      theme.colorScheme === "dark" ? "rgba(32, 116, 74, 0.2)" : "rgba(32, 116, 74, 0.12)",
  },
  deskTabText: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  deskTabTextSelected: {
    color: theme.colorScheme === "dark" ? "#c3e3cf" : "#1d5e3d",
  },
  newDeskDivider: {
    width: 1,
    height: 16,
    marginHorizontal: theme.spacing[1],
    backgroundColor: theme.colors.border,
  },
  newDeskButton: {
    width: buttonControlHeight.xs,
    height: buttonControlHeight.xs,
  },
  // CUSTOM(desk-workboard)
  newDeskMenuTrigger: {
    width: buttonControlHeight.xs,
    height: buttonControlHeight.xs,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  workboardTab: {
    height: buttonControlHeight.xs,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.borderRadius.md,
    paddingLeft: theme.spacing[2],
  },
  workboardTabLabel: { height: "100%", justifyContent: "center" },
  workboardClose: { width: 20, height: 20 },
  content: { flex: 1, minHeight: 0 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
  },
  emptyTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.lg },
}));
