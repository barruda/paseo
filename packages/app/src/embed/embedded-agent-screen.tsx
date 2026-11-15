// CUSTOM(agent-embed): one agent conversation with no app navigation, for an iframe.
import { useEffect, useLayoutEffect, useMemo } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ComposerEditingScope } from "@/composer/editing-session";
import { useToast } from "@/contexts/toast-context";
import { subscribeEmbedOpenInApp } from "@/embed/embed-notice";
import {
  createPaneFocusContextValue,
  PaneFocusProvider,
  PaneProvider,
  type PaneContextValue,
} from "@/panels/pane-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { DiffDocumentWorkspaceCacheProvider } from "@/git/diff-document/workspace-cache";
import { SheetPaneHostProvider, type SheetPaneHost } from "@/screens/workspace/sheet-pane";
import { buildWorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import { AgentPanelContent } from "@/panels/agent-panel";
import { RetainedChatContent } from "@/panels/retained-chat-content";

const noop = () => {};

export function EmbeddedAgentScreen({
  serverId,
  workspaceId,
  agentId,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();

  useEffect(
    () => subscribeEmbedOpenInApp(() => toast.show(t("embed.openInApp"), { variant: "info" })),
    [t, toast],
  );

  // The workspace screen registers its visible agents with the viewed-timeline sync, which
  // is what fetches the timeline. Without a workspace screen, the embed does it itself.
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );
  useEffect(() => {
    void getHostRuntimeStore()
      .prepareAgentTimeline(serverId, agentId)
      .catch(() => undefined);
  }, [agentId, serverId]);
  useLayoutEffect(() => {
    if (!viewedTimelineSync) return;
    const sourceId = `embed:${agentId}`;
    viewedTimelineSync.replaceVisibleAgentIds(sourceId, [agentId]);
    return () => viewedTimelineSync.replaceVisibleAgentIds(sourceId, []);
  }, [agentId, viewedTimelineSync]);

  const target = useMemo(() => ({ kind: "agent", agentId }) as const, [agentId]);
  const tabId = `embed:${agentId}`;
  const paneContext = useMemo<PaneContextValue>(
    () => ({
      serverId,
      workspaceId,
      host: "main",
      tabId,
      target,
      openTab: noop,
      openPreferredTarget: noop,
      closeCurrentTab: noop,
      retargetCurrentTab: noop,
      setCurrentTabState: noop,
      openFileInWorkspace: () => toast.show(t("embed.openInApp"), { variant: "info" }),
      openImportSheet: noop,
    }),
    [serverId, workspaceId, tabId, target, toast, t],
  );
  // Subagent tracks read the sheet host; sheets opened from the embed keep the same stubs.
  const sheetPaneHost = useMemo<SheetPaneHost>(
    () => ({
      workspaceKey: `${serverId}:${workspaceId}`,
      serverId,
      workspaceId,
      isWorkspaceFocused: true,
      buildContent: (tab, closeCurrentTab) =>
        buildWorkspacePaneContentModel({
          tab,
          normalizedServerId: serverId,
          normalizedWorkspaceId: workspaceId,
          host: "sheet",
          onOpenTab: noop,
          onOpenPreferredTarget: noop,
          onCloseCurrentTab: closeCurrentTab,
          onRetargetCurrentTab: noop,
          onSetCurrentTabState: noop,
          onOpenWorkspaceFile: paneContext.openFileInWorkspace,
          onOpenImportSheet: noop,
        }),
    }),
    [paneContext.openFileInWorkspace, serverId, workspaceId],
  );
  const focus = useMemo(
    () => createPaneFocusContextValue({ isWorkspaceFocused: true, isPaneFocused: true }),
    [],
  );

  return (
    <View style={styles.container} testID="embedded-agent-screen">
      <DiffDocumentWorkspaceCacheProvider>
        <SheetPaneHostProvider value={sheetPaneHost}>
          <PaneProvider value={paneContext}>
            <PaneFocusProvider value={focus}>
              <EmbeddedConversation
                serverId={serverId}
                workspaceId={workspaceId}
                agentId={agentId}
                tabId={tabId}
                targetKey={JSON.stringify(target)}
                onOpenWorkspaceFile={paneContext.openFileInWorkspace}
              />
            </PaneFocusProvider>
          </PaneProvider>
        </SheetPaneHostProvider>
      </DiffDocumentWorkspaceCacheProvider>
    </View>
  );
}

function EmbeddedConversation({
  serverId,
  workspaceId,
  agentId,
  tabId,
  targetKey,
  onOpenWorkspaceFile,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  tabId: string;
  targetKey: string;
  onOpenWorkspaceFile: PaneContextValue["openFileInWorkspace"];
}) {
  return (
    <ComposerEditingScope tabId={tabId} targetKey={targetKey}>
      <RetainedChatContent>
        <AgentPanelContent
          serverId={serverId}
          workspaceId={workspaceId}
          agentId={agentId}
          isPaneFocused
          onOpenWorkspaceFile={onOpenWorkspaceFile}
        />
      </RetainedChatContent>
    </ComposerEditingScope>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minWidth: 0,
    backgroundColor: theme.colors.surface0,
  },
}));
