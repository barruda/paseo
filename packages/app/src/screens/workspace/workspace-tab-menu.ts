import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { i18n } from "@/i18n/i18next";
import { encodeFilePathForPathSegment, encodeWorkspaceIdForPathSegment } from "@/utils/host-routes";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";

export type WorkspaceTabMenuSurface = "desktop" | "mobile";

export interface WorkspaceTabMenuLabels {
  copyResumeCommand: string;
  copyAgentId: string;
  copyTerminalId: string;
  copyFilePath: string;
  // CUSTOM(copy-full-file-path): optional so upstream's label builders need no edit.
  copyFullFilePath?: string;
  rename: string;
  closeAbove: string;
  closeBelow: string;
  closeLeft: string;
  closeRight: string;
  closeOthers: string;
  reloadAgent: string;
  reloadAgentTooltip: string;
  close: string;
}

export const DEFAULT_WORKSPACE_TAB_MENU_LABELS: WorkspaceTabMenuLabels = {
  copyResumeCommand: i18n.t("workspace.tabs.menu.copyResumeCommand"),
  copyAgentId: i18n.t("workspace.tabs.menu.copyAgentId"),
  copyTerminalId: i18n.t("workspace.tabs.menu.copyTerminalId"),
  copyFilePath: i18n.t("workspace.tabs.menu.copyFilePath"),
  rename: i18n.t("workspace.tabs.menu.rename"),
  closeAbove: i18n.t("workspace.tabs.menu.closeAbove"),
  closeBelow: i18n.t("workspace.tabs.menu.closeBelow"),
  closeLeft: i18n.t("workspace.tabs.menu.closeLeft"),
  closeRight: i18n.t("workspace.tabs.menu.closeRight"),
  closeOthers: i18n.t("workspace.tabs.menu.closeOthers"),
  reloadAgent: i18n.t("workspace.tabs.menu.reloadAgent"),
  reloadAgentTooltip: i18n.t("workspace.tabs.menu.reloadAgentTooltip"),
  close: i18n.t("workspace.tabs.menu.close"),
};

export type WorkspaceTabMenuEntry =
  | {
      kind: "item";
      key: string;
      label: string;
      icon?:
        | "globe"
        | "external-link"
        | "copy"
        | "rotate-cw"
        | "arrow-left-to-line"
        | "arrow-right-to-line"
        | "copy-x"
        | "pencil"
        // CUSTOM(task-pins)
        | "pin"
        | "pin-off"
        | "x";
      hint?: string;
      tooltip?: string;
      disabled?: boolean;
      destructive?: boolean;
      testID: string;
      onSelect: () => void;
    }
  | {
      kind: "separator";
      key: string;
    };

interface BuildWorkspaceTabMenuEntriesInput {
  surface: WorkspaceTabMenuSurface;
  tab: WorkspaceTabDescriptor;
  index: number;
  tabCount: number;
  menuTestIDBase: string;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  // CUSTOM(copy-full-file-path): "full" asks for the absolute path. CUSTOM(desks): tabId
  // lets a Desk resolve which workspace the path is relative to.
  onCopyFilePath: (path: string, mode?: "full", tabId?: string) => Promise<void> | void;
  // CUSTOM(open-file-externally): local desktop file actions.
  onOpenFile?: (path: string, mode: "browser" | "default", tabId?: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCloseTabsBefore: (tabId: string) => Promise<void> | void;
  onCloseTabsAfter: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  labels?: WorkspaceTabMenuLabels;
  // CUSTOM(task-pins): agent tabs pin or unpin their session in the Tasks sidebar.
  agentPin?: { pinned: boolean; toggle(): void };
  // CUSTOM(tab-pins): any tab pins or unpins itself at the left of its tab row.
  tabPin?: { pinned: boolean; toggle(): void };
}

interface BuildWorkspaceDesktopTabActionsInput {
  tab: WorkspaceTabDescriptor;
  index: number;
  tabCount: number;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  // CUSTOM(copy-full-file-path): "full" asks for the absolute path. CUSTOM(desks): tabId
  // lets a Desk resolve which workspace the path is relative to.
  onCopyFilePath: (path: string, mode?: "full", tabId?: string) => Promise<void> | void;
  // CUSTOM(open-file-externally): local desktop file actions.
  onOpenFile?: (path: string, mode: "browser" | "default", tabId?: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  labels?: WorkspaceTabMenuLabels;
  // CUSTOM(task-pins): agent tabs pin or unpin their session in the Tasks sidebar.
  agentPin?: { pinned: boolean; toggle(): void };
  // CUSTOM(tab-pins): any tab pins or unpins itself at the left of its tab row.
  tabPin?: { pinned: boolean; toggle(): void };
}

export interface WorkspaceDesktopTabActions {
  contextMenuTestId: string;
  menuEntries: WorkspaceTabMenuEntry[];
  closeButtonTestId: string;
}

function buildCloseBeforeLabel(
  surface: WorkspaceTabMenuSurface,
  labels: WorkspaceTabMenuLabels,
): string {
  return surface === "mobile" ? labels.closeAbove : labels.closeLeft;
}

function buildCloseAfterLabel(
  surface: WorkspaceTabMenuSurface,
  labels: WorkspaceTabMenuLabels,
): string {
  return surface === "mobile" ? labels.closeBelow : labels.closeRight;
}

function buildCloseBeforeTestIDSuffix(surface: WorkspaceTabMenuSurface): string {
  return surface === "mobile" ? "close-above" : "close-left";
}

function buildCloseAfterTestIDSuffix(surface: WorkspaceTabMenuSurface): string {
  return surface === "mobile" ? "close-below" : "close-right";
}

function getCloseButtonTestId(tab: WorkspaceTabDescriptor): string {
  if (tab.target.kind === "agent") {
    return `workspace-agent-close-${tab.target.agentId}`;
  }
  if (tab.target.kind === "terminal") {
    return `workspace-terminal-close-${tab.target.terminalId}`;
  }
  if (tab.target.kind === "draft") {
    return `workspace-draft-close-${tab.target.draftId}`;
  }
  if (tab.target.kind === "browser") {
    return `workspace-browser-close-${tab.target.browserId}`;
  }
  if (tab.target.kind === "setup") {
    return `workspace-setup-close-${encodeWorkspaceIdForPathSegment(tab.target.workspaceId)}`;
  }
  if (tab.target.kind === "provider_subagent") {
    return `workspace-provider-subagent-close-${tab.target.subagentId}`;
  }
  if (tab.target.kind === "commit_diff") {
    return `workspace-commit-diff-close-${encodeFilePathForPathSegment(tab.target.sha)}`;
  }
  if (tab.target.kind === "working_diff" || tab.target.kind === "changes_tree") {
    return `workspace-working-diff-close-${encodeFilePathForPathSegment(buildDeterministicWorkspaceTabId(tab.target))}`;
  }
  if (tab.target.kind === "files" || tab.target.kind === "pull_request") {
    return `workspace-${tab.target.kind}-close`;
  }
  if (tab.target.kind === "plugin") {
    return `workspace-plugin-close-${encodeFilePathForPathSegment(buildDeterministicWorkspaceTabId(tab.target))}`;
  }
  if (tab.target.kind === "new_tab") {
    return `workspace-new-tab-close-${tab.tabId}`;
  }
  // CUSTOM(history-search-tabs)
  if (tab.target.kind === "history_search") {
    return `workspace-history-search-close-${encodeFilePathForPathSegment(buildDeterministicWorkspaceTabId(tab.target))}`;
  }
  return `workspace-file-close-${encodeFilePathForPathSegment(tab.target.path)}`;
}

export function buildWorkspaceTabMenuEntries(
  input: BuildWorkspaceTabMenuEntriesInput,
): WorkspaceTabMenuEntry[] {
  const {
    surface,
    tab,
    index,
    tabCount,
    menuTestIDBase,
    onCopyResumeCommand,
    onCopyAgentId,
    onCopyTerminalId,
    onCopyFilePath,
    onOpenFile,
    onReloadAgent,
    onRenameTab,
    onCloseTab,
    onCloseTabsBefore,
    onCloseTabsAfter,
    onCloseOtherTabs,
  } = input;
  const labels = input.labels ?? DEFAULT_WORKSPACE_TAB_MENU_LABELS;
  const isFirstTab = index === 0;
  const isLastTab = index === tabCount - 1;
  const isOnlyTab = tabCount <= 1;
  const entries: WorkspaceTabMenuEntry[] = [];
  // CUSTOM(tab-pins): right before Pin to Tasks, or before the close actions.
  const pushTabPin = () => {
    if (!input.tabPin) return;
    const { pinned, toggle } = input.tabPin;
    entries.push({
      kind: "item",
      key: "pin-tab",
      label: pinned ? "Unpin tab" : "Pin tab",
      icon: pinned ? "pin-off" : "pin",
      testID: `${menuTestIDBase}-pin-tab`,
      onSelect: toggle,
    });
  };

  if (tab.target.kind === "agent") {
    const { agentId } = tab.target;
    entries.push({
      kind: "item",
      key: "copy-resume-command",
      label: labels.copyResumeCommand,
      icon: "copy",
      testID: `${menuTestIDBase}-copy-resume-command`,
      onSelect: () => {
        void onCopyResumeCommand(agentId);
      },
    });
    entries.push({
      kind: "item",
      key: "copy-agent-id",
      label: labels.copyAgentId,
      icon: "copy",
      hint: agentId.slice(0, 7),
      testID: `${menuTestIDBase}-copy-agent-id`,
      onSelect: () => {
        void onCopyAgentId(agentId);
      },
    });
  }

  if (tab.target.kind === "terminal") {
    const { terminalId } = tab.target;
    entries.push({
      kind: "item",
      key: "copy-terminal-id",
      label: labels.copyTerminalId,
      icon: "copy",
      hint: terminalId.slice(0, 7),
      testID: `${menuTestIDBase}-copy-terminal-id`,
      onSelect: () => {
        void onCopyTerminalId(terminalId);
      },
    });
  }

  if (tab.target.kind === "file") {
    const filePath = tab.target.path;
    // CUSTOM(copy-full-file-path): the absolute path, resolved against the workspace root by
    // the handler. "Copy file path" below copies the tab's path as stored (often relative).
    entries.push({
      kind: "item",
      key: "copy-full-file-path",
      label: labels.copyFullFilePath ?? "Copy full file path",
      icon: "copy",
      testID: `${menuTestIDBase}-copy-full-file-path`,
      onSelect: () => {
        void onCopyFilePath(filePath, "full", tab.tabId);
      },
    });
    entries.push({
      kind: "item",
      key: "copy-file-path",
      label: labels.copyFilePath,
      icon: "copy",
      testID: `${menuTestIDBase}-copy-file-path`,
      onSelect: () => {
        void onCopyFilePath(filePath);
      },
    });
  }

  // CUSTOM(open-file-externally): immediately follow the file path copy actions.
  if (tab.target.kind === "file" && onOpenFile) {
    const filePath = tab.target.path;
    for (const [mode, label, icon] of [
      ["browser", "Open in browser", "globe"],
      ["default", "Open with default app", "external-link"],
    ] as const) {
      entries.push({
        kind: "item",
        key: `open-file-${mode}`,
        label,
        icon,
        testID: `${menuTestIDBase}-open-file-${mode}`,
        onSelect: () => {
          void onOpenFile(filePath, mode, tab.tabId);
        },
      });
    }
  }

  // CUSTOM(draft-agent-title): a New Agent tab can be named before its agent exists.
  if (
    tab.target.kind === "agent" ||
    tab.target.kind === "terminal" ||
    tab.target.kind === "draft"
  ) {
    entries.push({
      kind: "item",
      key: "rename",
      label: labels.rename,
      icon: "pencil",
      testID: `${menuTestIDBase}-rename`,
      onSelect: () => {
        onRenameTab(tab);
      },
    });
    pushTabPin(); // CUSTOM(tab-pins)
    // CUSTOM(task-pins)
    if (tab.target.kind === "agent" && input.agentPin) {
      const { pinned, toggle } = input.agentPin;
      entries.push({
        kind: "item",
        key: "pin",
        // CUSTOM(tab-pins): named apart from "Pin tab".
        label: pinned ? "Unpin from Tasks" : "Pin to Tasks",
        icon: pinned ? "pin-off" : "pin",
        testID: `${menuTestIDBase}-pin`,
        onSelect: toggle,
      });
    }
    entries.push({
      kind: "separator",
      key: "rename-separator",
    });
  } else if (input.tabPin) {
    // CUSTOM(tab-pins)
    pushTabPin();
    entries.push({ kind: "separator", key: "pin-tab-separator" });
  }

  entries.push({
    kind: "item",
    key: "close-before",
    label: buildCloseBeforeLabel(surface, labels),
    icon: "arrow-left-to-line",
    disabled: isFirstTab,
    testID: `${menuTestIDBase}-${buildCloseBeforeTestIDSuffix(surface)}`,
    onSelect: () => {
      void onCloseTabsBefore(tab.tabId);
    },
  });
  entries.push({
    kind: "item",
    key: "close-after",
    label: buildCloseAfterLabel(surface, labels),
    icon: "arrow-right-to-line",
    disabled: isLastTab,
    testID: `${menuTestIDBase}-${buildCloseAfterTestIDSuffix(surface)}`,
    onSelect: () => {
      void onCloseTabsAfter(tab.tabId);
    },
  });
  entries.push({
    kind: "item",
    key: "close-others",
    label: labels.closeOthers,
    icon: "copy-x",
    disabled: isOnlyTab,
    testID: `${menuTestIDBase}-close-others`,
    onSelect: () => {
      void onCloseOtherTabs(tab.tabId);
    },
  });
  if (tab.target.kind === "agent") {
    const { agentId } = tab.target;
    entries.push({
      kind: "item",
      key: "reload-agent",
      label: labels.reloadAgent,
      icon: "rotate-cw",
      tooltip: labels.reloadAgentTooltip,
      testID: `${menuTestIDBase}-reload-agent`,
      onSelect: () => {
        void onReloadAgent(agentId);
      },
    });
  }
  entries.push({
    kind: "item",
    key: "close",
    label: labels.close,
    icon: "x",
    testID: `${menuTestIDBase}-close`,
    onSelect: () => {
      void onCloseTab(tab.tabId);
    },
  });

  return entries;
}

export function buildWorkspaceDesktopTabActions(
  input: BuildWorkspaceDesktopTabActionsInput,
): WorkspaceDesktopTabActions {
  const contextMenuTestId = `workspace-tab-context-${input.tab.tabId}`;
  return {
    contextMenuTestId,
    menuEntries: buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: input.tab,
      index: input.index,
      tabCount: input.tabCount,
      menuTestIDBase: contextMenuTestId,
      onCopyResumeCommand: input.onCopyResumeCommand,
      onCopyAgentId: input.onCopyAgentId,
      onCopyTerminalId: input.onCopyTerminalId,
      onCopyFilePath: input.onCopyFilePath,
      onOpenFile: input.onOpenFile,
      onReloadAgent: input.onReloadAgent,
      onRenameTab: input.onRenameTab,
      onCloseTab: input.onCloseTab,
      onCloseTabsBefore: input.onCloseTabsToLeft,
      onCloseTabsAfter: input.onCloseTabsToRight,
      onCloseOtherTabs: input.onCloseOtherTabs,
      labels: input.labels,
      agentPin: input.agentPin,
      tabPin: input.tabPin,
    }),
    closeButtonTestId: getCloseButtonTestId(input.tab),
  };
}
