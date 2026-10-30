import { revealWorkspaceTab } from "./navigation";
import type { OpenInSidePanePreferences } from "@/hooks/use-settings";
import {
  collectAllTabs,
  collectAllPanes,
  DEFAULT_PANE_ID,
  findPaneById,
  findPaneContainingTab,
  selectSheetTab,
  useWorkspaceLayoutStore,
  type WorkspaceTabPlacement,
} from "@/stores/workspace-layout-store";
import { getPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import { workspaceTabTargetsEqual } from "@/workspace-tabs/identity";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { findDiffTabToReuse, isInBottomPanel } from "@/git/diff-tabs/model";
import { BOTTOM_PANEL_PANE_ID } from "@/workspace-tabs/bottom-panel";
import { useDiffTabsStore } from "@/git/diff-tabs/store";

export type OpenInSidePaneSource = keyof OpenInSidePanePreferences;
export type WorkspaceTargetOpenLocation = "main" | "side";

interface OpenWorkspaceTargetInput {
  workspaceKey: string | null;
  target: WorkspaceTabTarget;
  parentTabId?: string | null;
}

export interface OpenPreferredWorkspaceTargetInput extends OpenWorkspaceTargetInput {
  source: OpenInSidePaneSource;
  preferences: OpenInSidePanePreferences;
}

interface OpenWorkspaceTargetAtLocationInput extends OpenWorkspaceTargetInput {
  location: WorkspaceTargetOpenLocation;
}

interface OpenPreferredWorkspacePreviewInput extends OpenPreferredWorkspaceTargetInput {
  serverId: string;
  workspaceId: string;
  explorerSidebarPaneId: string | null;
  lastMainPaneId: string | null;
}

/** A side pane exists only where the workspace renders split panes. */
function canOpenBeside(): boolean {
  return useWorkspaceLayoutStore.getState().layoutMode === "split-panes";
}

function resolveMainPane(input: {
  workspaceKey: string;
  explorerSidebarPaneId: string | null;
  lastMainPaneId: string | null;
}) {
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[input.workspaceKey];
  if (!layout) return null;
  // CUSTOM(changes-main-content): Explorer clicks never land in the bottom panel, even when it
  // had focus last.
  const panes = collectAllPanes(layout.root).filter((pane) => pane.id !== BOTTOM_PANEL_PANE_ID);
  return (
    panes.find(
      (pane) =>
        pane.id === input.lastMainPaneId &&
        pane.id !== input.explorerSidebarPaneId &&
        pane.hidden !== true,
    ) ??
    panes.find((pane) => pane.id === DEFAULT_PANE_ID && pane.hidden !== true) ??
    panes.find((pane) => pane.id !== input.explorerSidebarPaneId && pane.hidden !== true) ??
    null
  );
}

function canReplacePreview(input: {
  serverId: string;
  workspaceId: string;
  tabId: string;
  currentTarget: WorkspaceTabTarget;
  nextTarget: WorkspaceTabTarget;
}): boolean {
  if (input.nextTarget.kind === "working_diff") {
    // CUSTOM(changes-diff-tab): reusing a diff tab is decided before this; with "Open in
    // different tabs" on, every file gets its own tab.
    return false;
  }
  return (
    input.nextTarget.kind === "file" &&
    input.currentTarget.kind === "file" &&
    !getPanelInstanceAttributes({
      serverId: input.serverId,
      workspaceId: input.workspaceId,
      tabId: input.tabId,
    }).modified
  );
}

/** Opens an implicit target according to its source-specific desktop preference. */
export function openPreferredWorkspaceTarget(
  input: OpenPreferredWorkspaceTargetInput,
): string | null {
  return openWorkspaceTargetAtLocation({
    workspaceKey: input.workspaceKey,
    target: input.target,
    location: input.preferences[input.source] ? "side" : "main",
    parentTabId: input.parentTabId,
  });
}

/** Opens an implicit target at the user's preferred main or side location. */
export function openWorkspaceTargetAtLocation(
  input: OpenWorkspaceTargetAtLocationInput,
): string | null {
  if (!input.workspaceKey) return null;
  const store = useWorkspaceLayoutStore.getState();
  const layout = store.layoutByWorkspace[input.workspaceKey];
  const targetAlreadyExists = Boolean(
    layout &&
    collectAllTabs(layout.root).some((tab) => workspaceTabTargetsEqual(tab.target, input.target)),
  );
  const shouldOpenBeside = canOpenBeside() && input.location === "side";
  let placement: WorkspaceTabPlacement | undefined;
  if (shouldOpenBeside && !targetAlreadyExists) {
    const paneId = store.ensureSidePane(input.workspaceKey);
    placement = paneId ? { mode: "prefer", paneId } : undefined;
  } else if (!shouldOpenBeside && layout && input.parentTabId) {
    // A target opened from a tab belongs in that tab's pane, whichever pane has focus.
    const parentPane = findPaneContainingTab(layout.root, input.parentTabId);
    placement = parentPane ? { mode: "prefer", paneId: parentPane.id } : undefined;
  }
  return revealWorkspaceTab(
    input.workspaceKey,
    store.openTab({
      workspaceKey: input.workspaceKey,
      target: input.target,
      intent: "reveal",
      placement,
      parentTabId: input.parentTabId ?? undefined,
    }),
  );
}

/** Opens a tree selection while reusing an unmodified preview in its destination pane. */
export function openPreferredWorkspacePreview(
  input: OpenPreferredWorkspacePreviewInput,
): string | null {
  if (!input.workspaceKey) return null;
  const store = useWorkspaceLayoutStore.getState();
  const layout = store.layoutByWorkspace[input.workspaceKey];
  if (!layout) return null;
  const existing = collectAllTabs(layout.root).some((tab) =>
    workspaceTabTargetsEqual(tab.target, input.target),
  );
  // The sheet is already a single replaceable slot, so it needs no preview tab.
  if (
    existing ||
    selectSheetTab(store, { workspaceKey: input.workspaceKey, target: input.target }) !== null
  ) {
    return openPreferredWorkspaceTarget(input);
  }
  // CUSTOM(changes-diff-tab): a Changes file click scrolls the open diff tab to the file, or with
  // "Open in different tabs" gets a tab of its own.
  const openInNewTabs = useDiffTabsStore.getState().openInNewTabs;
  const diffTab = findDiffTabToReuse({
    // CUSTOM(changes-main-content): a diff tab in the bottom panel is not reused.
    tabs: collectAllTabs(layout.root).filter((tab) => !isInBottomPanel(layout.root, tab.tabId)),
    target: input.target,
    openInNewTabs,
  });
  if (diffTab) {
    return revealWorkspaceTab(
      input.workspaceKey,
      store.replaceTab(input.workspaceKey, diffTab.tabId, input.target),
    );
  }
  const newDiffTab = openInNewTabs && input.target.kind === "working_diff";

  const mainPane = resolveMainPane({
    workspaceKey: input.workspaceKey,
    explorerSidebarPaneId: input.explorerSidebarPaneId,
    lastMainPaneId: input.lastMainPaneId,
  });
  const destinationPaneId =
    canOpenBeside() && input.preferences[input.source]
      ? store.ensureSidePane(input.workspaceKey)
      : mainPane?.id;
  if (!destinationPaneId) return null;
  const nextLayout = useWorkspaceLayoutStore.getState().layoutByWorkspace[input.workspaceKey];
  const destinationPane = nextLayout ? findPaneById(nextLayout.root, destinationPaneId) : null;
  const activeTab = nextLayout
    ? collectAllTabs(nextLayout.root).find((tab) => tab.tabId === destinationPane?.focusedTabId)
    : null;
  if (
    activeTab &&
    canReplacePreview({
      serverId: input.serverId,
      workspaceId: input.workspaceId,
      tabId: activeTab.tabId,
      currentTarget: activeTab.target,
      nextTarget: input.target,
    })
  ) {
    return revealWorkspaceTab(
      input.workspaceKey,
      store.replaceTab(input.workspaceKey, activeTab.tabId, input.target),
    );
  }
  return revealWorkspaceTab(
    input.workspaceKey,
    store.openTab({
      workspaceKey: input.workspaceKey,
      target: input.target,
      intent: newDiffTab ? "new" : "reveal",
      placement: { mode: "pane", paneId: destinationPaneId },
      parentTabId: input.parentTabId ?? activeTab?.tabId ?? undefined,
    }),
  );
}

/**
 * Explicit Open to Side: creates the side pane and places the target there. Without split panes
 * the target opens like any other.
 */
export function openWorkspaceTargetBeside(input: OpenWorkspaceTargetInput): string | null {
  if (!input.workspaceKey) return null;
  if (!canOpenBeside()) {
    return openWorkspaceTargetAtLocation({ ...input, location: "main" });
  }
  const store = useWorkspaceLayoutStore.getState();
  const paneId = store.ensureSidePane(input.workspaceKey);
  return revealWorkspaceTab(
    input.workspaceKey,
    store.openTab({
      workspaceKey: input.workspaceKey,
      target: input.target,
      intent: "reveal",
      placement: paneId ? { mode: "pane", paneId } : undefined,
      parentTabId: input.parentTabId ?? undefined,
    }),
  );
}
