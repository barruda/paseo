import { useMiddleClick } from "./use-middle-click";
import { DeskNewTabMenu } from "./new-tab-menu";
import { TaskProjectIcon, TaskProjectIconsProvider } from "./project-icon";
import { deskTabLabel } from "./model";
import { WorkspaceActions } from "@/git/workspace-actions";
import { WorkspaceOpenInEditorButton } from "@/workspace/open-in-editor/button";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { useNavigateToImportedAgent } from "@/hooks/use-import-session";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useMountedTabSet } from "@/screens/workspace/use-mounted-tab-set";
// CUSTOM(desks): a stable cross-workspace panel host, independent of workspace layouts.
import { memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { StyleSheet } from "react-native-unistyles";
import { Plus, Pin, X } from "lucide-react-native";
import { SelectFieldTrigger } from "@/components/ui/select-field";
import { DensityIcon } from "@/components/ui/density-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { ScreenHeader } from "@/components/headers/screen-header";
import { SidebarMenuToggle } from "@/components/headers/sidebar-menu-toggle";
import { HeaderShortcutsRightRow, useHeaderShortcutsRowLayout } from "@/header-shortcuts/layout";
import {
  FloatingPanelPortalHost,
  FloatingPanelPortalHostNameProvider,
} from "@/components/ui/floating-panel-portal";
import { RetainedPanel } from "@/components/retained-panel";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectory, useWorkspaceFields } from "@/stores/session-store-hooks";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  WorkspacePaneContent,
  buildWorkspacePaneContentModel,
} from "@/screens/workspace/workspace-pane-content";
import {
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import {
  getPanelInstanceAttributes,
  usePanelInstanceAttributes,
} from "@/panels/panel-instance-attributes";
import { DiffDocumentWorkspaceCacheProvider } from "@/git/diff-document/workspace-cache";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  useDesksStore,
  activeDesk,
  activeDeskTab,
  type DeskTab,
  type DeskTabInput,
} from "./desks-store";

function descriptor(tab: DeskTab) {
  return {
    key: tab.id,
    tabId: tab.id,
    kind: tab.target.kind,
    target: tab.target,
    state: tab.state,
  };
}
export function DeskScreen() {
  const screenId = useId();
  const portalHost = `desk-floating-panels:${screenId}`;
  const desks = useDesksStore((s) => s.desks);
  const desk = useDesksStore(activeDesk);
  const active = useDesksStore(activeDeskTab);
  const selection = useActiveWorkspaceSelection();
  const isFocused = useIsFocused();
  const [hydrated, setHydrated] = useState(useDesksStore.persist.hasHydrated());
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [naming, setNaming] = useState<"create" | "rename" | null>(null);
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
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
      ? collectAllTabs(layout.root).find((t) => t.tabId === pane?.focusedTabId)
      : null;
    useDesksStore
      .getState()
      .initialize(
        tab && tab.target.kind !== "new_tab"
          ? { ...selection, target: tab.target, state: tab.state }
          : undefined,
      );
  }, [hydrated, selection]);
  useEffect(() => {
    if (active)
      setVisited((previous) =>
        previous.has(active.id) ? previous : new Set([...previous, active.id]),
      );
  }, [active]);
  useKeyboardActionHandler({
    handlerId: `desk-tab-actions:${screenId}`,
    enabled: isFocused,
    priority: 200,
    actions: [
      "workspace.tab.menu.open",
      "workspace.tab.close-current",
      "workspace.tab.navigate-index",
      "workspace.tab.navigate-relative",
      "message-input.active-workspace-cycle",
    ],
    handle: (action) => {
      const store = useDesksStore.getState();
      const current = activeDesk(store);
      const currentTab = activeDeskTab(store);
      const tabs = [...(current.preview ? [current.preview] : []), ...current.tabs];
      if (action.id === "workspace.tab.menu.open") {
        setTabMenuOpen(true);
        return true;
      }
      if (action.id === "message-input.active-workspace-cycle") {
        const index = store.desks.findIndex((d) => d.id === current.id);
        store.selectDesk(store.desks[(index + 1) % store.desks.length]!.id);
        return true;
      }
      if (action.id === "workspace.tab.close-current") {
        if (
          currentTab &&
          !getPanelInstanceAttributes({
            serverId: currentTab.serverId,
            workspaceId: currentTab.workspaceId,
            tabId: currentTab.id,
          }).modified
        )
          store.closeTab(currentTab.id);
        return true;
      }
      if (action.id === "workspace.tab.navigate-index") {
        const tab = tabs[action.index === 9 ? tabs.length - 1 : action.index - 1];
        if (tab) store.selectTab(tab.id);
        return true;
      }
      if (action.id === "workspace.tab.navigate-relative") {
        const index = tabs.findIndex((t) => t.id === currentTab?.id);
        const tab = tabs[(index + action.delta + tabs.length) % tabs.length];
        if (tab) store.selectTab(tab.id);
        return true;
      }
      return false;
    },
  });
  const closeNaming = useCallback(() => setNaming(null), []);
  const create = useCallback(() => setNaming("create"), []);
  const rename = useCallback(() => setNaming("rename"), []);
  const submitName = useCallback(
    (name: string) => {
      if (naming === "create") useDesksStore.getState().createDesk(name);
      else useDesksStore.getState().renameDesk(name);
    },
    [naming],
  );
  const keep = useDesksStore((s) => s.keepPreview);
  const allTabs = useMemo(
    () => desks.flatMap((d) => [...(d.preview ? [d.preview] : []), ...d.tabs]),
    [desks],
  );
  const allTabIds = useMemo(() => allTabs.map((tab) => tab.id), [allTabs]);
  const retainedToolIds = useMemo(
    () =>
      new Set(
        allTabs
          .filter((tab) => visited.has(tab.id) && tab.target.kind !== "agent")
          .map((tab) => tab.id),
      ),
    [allTabs, visited],
  );
  const { mountedTabIds } = useMountedTabSet({
    activeTabId: active?.id ?? null,
    allTabIds,
    cap: 6,
    retainedTabIds: retainedToolIds,
  });
  const headerLeft = useMemo(
    () => (
      <View style={styles.headerLeft}>
        <SidebarMenuToggle />
        <Text style={styles.context} numberOfLines={1}>
          {active ? <DeskContext tab={active} /> : "Choose a task"}
        </Text>
        <DropdownMenu>
          <DropdownMenuTrigger testID="desk-selector">
            <SelectFieldTrigger label={desk.name} placeholder="Desk" size="sm" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {desks.map((entry) => (
              <DeskChoice
                key={entry.id}
                id={entry.id}
                name={entry.name}
                selected={entry.id === desk.id}
              />
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={create} testID="desk-create">
              New Desk…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={rename}>Rename Desk…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
    ),
    [active, desk.id, desk.name, desks, create, rename],
  );
  const headerRight = useMemo(
    () => (
      <HeaderShortcutsRightRow layoutKey={screenId} style={styles.headerLeft}>
        {active ? <DeskWorkspaceActions tab={active} /> : null}
      </HeaderShortcutsRightRow>
    ),
    [screenId, active],
  );
  const scope = useMemo<DeskTabInput | null>(
    () => active ?? (selection ? { ...selection, target: { kind: "files" } } : null),
    [active, selection],
  );
  return (
    <TaskProjectIconsProvider>
      <FloatingPanelPortalHostNameProvider hostName={portalHost}>
        <View style={styles.root} testID="desk-screen">
          <ScreenHeader onRowLayout={onRowLayout} left={headerLeft} right={headerRight} />
          <View style={styles.tabsRow}>
            <ScrollView horizontal style={styles.tabs} contentContainerStyle={styles.tabItems}>
              {desk.preview ? (
                <DeskTabButton
                  tab={desk.preview}
                  preview
                  selected={active?.id === desk.preview.id}
                />
              ) : (
                <Text style={styles.previewPlaceholder}>Preview · select a task</Text>
              )}
              {desk.tabs.map((tab) => (
                <DeskTabButton key={tab.id} tab={tab} selected={active?.id === tab.id} />
              ))}
            </ScrollView>
            {desk.preview && active?.id === desk.preview.id ? (
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
            <DeskAddTab scope={scope} open={tabMenuOpen} onOpenChange={setTabMenuOpen} />
          </View>
          <View style={styles.content}>
            {allTabs
              .filter((tab) => mountedTabIds.has(tab.id))
              .map((tab) => (
                <DeskPanel key={tab.id} tab={tab} visible={isFocused && tab.id === active?.id} />
              ))}
            {!active ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>{desk.name}</Text>
                <Text style={styles.context}>
                  Click a task to preview it. Middle-click to keep it as a tab.
                </Text>
              </View>
            ) : null}
          </View>
          <FloatingPanelPortalHost name={portalHost} />
          <AdaptiveRenameModal
            visible={naming !== null}
            title={naming === "create" ? "New Desk" : "Rename Desk"}
            initialValue={naming === "rename" ? desk.name : ""}
            placeholder="e.g. While waiting"
            submitLabel={naming === "create" ? "Create Desk" : "Save"}
            onClose={closeNaming}
            onSubmit={submitName}
            testID="desk-name-modal"
          />
        </View>
      </FloatingPanelPortalHostNameProvider>
    </TaskProjectIconsProvider>
  );
}
function DeskWorkspaceActions({ tab }: { tab: DeskTab }) {
  const directory = useWorkspaceDirectory(tab.serverId, tab.workspaceId);
  if (!directory) return null;
  return (
    <>
      <WorkspaceOpenInEditorButton
        serverId={tab.serverId}
        cwd={directory}
        activeFile={tab.target.kind === "file" ? tab.target : null}
        hideLabels
      />
      <WorkspaceActions serverId={tab.serverId} cwd={directory} />
    </>
  );
}
function DeskChoice({ id, name, selected }: { id: string; name: string; selected: boolean }) {
  const select = useCallback(() => useDesksStore.getState().selectDesk(id), [id]);
  return (
    <DropdownMenuItem selected={selected} onSelect={select} testID={`desk-choice-${id}`}>
      {name}
    </DropdownMenuItem>
  );
}
function DeskContext({ tab }: { tab: DeskTab }) {
  const workspace = useWorkspaceFields(tab.serverId, tab.workspaceId, (w) => ({
    name: w.title ?? w.name,
    project: w.projectCustomName ?? w.projectDisplayName,
  }));
  return (
    <>
      {workspace?.project ?? "Project"} · {workspace?.name ?? "Workspace"}
    </>
  );
}
function DeskTabButton({
  tab,
  preview = false,
  selected,
}: {
  tab: DeskTab;
  preview?: boolean;
  selected: boolean;
}) {
  const value = useMemo(() => descriptor(tab), [tab]);
  const render = useCallback(
    (presentation: WorkspaceTabPresentation) => (
      <DeskTabLabel
        tab={tab}
        label={presentation.label || presentation.subtitle}
        modified={presentation.modified}
        preview={preview}
        selected={selected}
      />
    ),
    [tab, preview, selected],
  );
  return (
    <WorkspaceTabPresentationResolver
      tab={value}
      serverId={tab.serverId}
      workspaceId={tab.workspaceId}
    >
      {render}
    </WorkspaceTabPresentationResolver>
  );
}
function DeskTabLabel({
  tab,
  label,
  modified,
  preview,
  selected,
}: {
  tab: DeskTab;
  label: string;
  modified: boolean;
  preview: boolean;
  selected: boolean;
}) {
  const select = useCallback(() => useDesksStore.getState().selectTab(tab.id), [tab.id]);
  const close = useCallback(() => {
    if (!modified) useDesksStore.getState().closeTab(tab.id);
  }, [tab.id, modified]);
  const middleClickRef = useMiddleClick(close);
  return (
    <View
      ref={middleClickRef}
      style={[styles.tab, preview && styles.preview, selected && styles.selectedTab]}
      testID={preview ? "desk-preview-tab" : "desk-pinned-tab"}
    >
      <Pressable
        accessibilityRole="button"
        onPress={select}
        style={styles.tabButton}
        accessibilityLabel={`${preview ? "Preview: " : ""}${label}`}
        testID={`desk-tab-${tab.id}`}
      >
        <Text numberOfLines={1} style={styles.tabLabel}>
          {deskTabLabel(label)}
        </Text>
        {modified ? <Text style={styles.tabLabel}>•</Text> : null}
      </Pressable>
      <TaskProjectIcon serverId={tab.serverId} workspaceId={tab.workspaceId} />
      <Button
        variant="ghost"
        size="xs"
        leftIcon={X}
        onPress={close}
        disabled={modified}
        accessibilityLabel={modified ? "Save changes before closing tab" : `Close ${label}`}
      />
    </View>
  );
}
const DeskPanel = memo(function DeskPanel({ tab, visible }: { tab: DeskTab; visible: boolean }) {
  const syncOwner = useId();
  const [importOpen, setImportOpen] = useState(false);
  const client = useHostRuntimeClient(tab.serverId);
  const directory = useWorkspaceDirectory(tab.serverId, tab.workspaceId);
  const navigateToImportedAgent = useNavigateToImportedAgent(tab.serverId);
  const openImport = useCallback(() => setImportOpen(true), []);
  const closeImport = useCallback(() => setImportOpen(false), []);
  const importedHere = useCallback(
    (agentId: string) =>
      useDesksStore.getState().openTab(
        {
          serverId: tab.serverId,
          workspaceId: tab.workspaceId,
          target: { kind: "agent", agentId },
        },
        true,
      ),
    [tab.serverId, tab.workspaceId],
  );
  const sync = useSessionStore((s) => s.sessions[tab.serverId]?.viewedTimelineSync ?? null);
  const identity = useMemo(
    () => ({ serverId: tab.serverId, workspaceId: tab.workspaceId, tabId: tab.id }),
    [tab.serverId, tab.workspaceId, tab.id],
  );
  const attributes = usePanelInstanceAttributes(identity);
  const currentTarget = tab.target;
  useEffect(() => {
    if (!sync) return;
    const owner = `desk:${syncOwner}`;
    let agentId: string | null = null;
    if (currentTarget.kind === "agent") agentId = currentTarget.agentId;
    if (currentTarget.kind === "provider_subagent") agentId = currentTarget.parentAgentId;
    sync.replaceVisibleAgentIds(owner, visible && agentId ? [agentId] : []);
    return () => sync.replaceVisibleAgentIds(owner, []);
  }, [sync, currentTarget, syncOwner, visible]);
  const content = useMemo(() => {
    const open = (target: WorkspaceTabTarget) =>
      useDesksStore
        .getState()
        .openTab({ serverId: tab.serverId, workspaceId: tab.workspaceId, target }, true);
    return buildWorkspacePaneContentModel({
      tab: descriptor(tab),
      normalizedServerId: tab.serverId,
      normalizedWorkspaceId: tab.workspaceId,
      host: "main",
      onOpenTab: open,
      onOpenPreferredTarget: open,
      onOpenTargetToSide: open,
      onCloseCurrentTab: () => {
        if (!attributes.modified) useDesksStore.getState().closeTab(tab.id);
      },
      onRetargetCurrentTab: (target) => useDesksStore.getState().updateTab(tab.id, { target }),
      onSetCurrentTabState: (state) => useDesksStore.getState().updateTab(tab.id, { state }),
      onOpenWorkspaceFile: (request) => open({ kind: "file", ...request.location }),
      onOpenImportSheet: openImport,
    });
  }, [tab, attributes.modified, openImport]);
  return (
    <RetainedPanel active={visible}>
      <DiffDocumentWorkspaceCacheProvider>
        <WorkspacePaneContent
          content={content}
          isWorkspaceFocused={visible}
          isPaneFocused={visible}
        />
      </DiffDocumentWorkspaceCacheProvider>
      {importOpen ? (
        <ImportSessionSheet
          visible={visible}
          client={client}
          serverId={tab.serverId}
          cwd={directory}
          workspaceId={tab.workspaceId}
          onClose={closeImport}
          onImportedAgent={importedHere}
          onImported={navigateToImportedAgent}
        />
      ) : null}
    </RetainedPanel>
  );
});
function DeskAddTab({
  scope,
  open,
  onOpenChange,
}: {
  scope: DeskTabInput | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel="Add tab to Desk"
        disabled={!scope}
        style={styles.addTab}
      >
        <DensityIcon icon={Plus} size="sm" color="foregroundMuted" />
      </DropdownMenuTrigger>
      {scope ? (
        <DeskNewTabMenu key={`${scope.serverId}:${scope.workspaceId}`} scope={scope} />
      ) : null}
    </DropdownMenu>
  );
}
const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], minWidth: 0 },
  context: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flexShrink: 1 },
  tabsRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[1],
    gap: theme.spacing[1],
  },
  tabs: { flex: 1 },
  tabItems: { alignItems: "center", gap: theme.spacing[1] },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: theme.borderRadius.md,
    maxWidth: 280,
  },
  tabButton: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing[2],
  },
  tabLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flexShrink: 1 },
  addTab: { padding: theme.spacing[2] },
  preview: { borderColor: theme.colors.statusDotRunning },
  selectedTab: { backgroundColor: theme.colors.surface3 },
  previewPlaceholder: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.statusDotRunning,
    borderRadius: theme.borderRadius.md,
  },
  content: { flex: 1, minHeight: 0 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing[3] },
  emptyTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.lg },
}));
