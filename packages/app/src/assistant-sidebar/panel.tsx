// CUSTOM(assistant-desk): the Projects Assistant tab of the Explorer sidebar. It is a view of the
// assistant Desk, not a second chat: it shows the Desk's focused agent tab with the ordinary agent
// panel (history, composer, pwb cards), so a new chat, a compaction or a restart swaps the chat in
// the same Explorer tab. When the Desk has no chat, it points back to the Desk. See custom/CHANGES.md.
import { useCallback, useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Bot } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { AgentConversationPanel } from "@/panels/agent-panel";
import { PaneProvider, usePaneContext, type PaneContextValue } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import { useDesksStore } from "@/task-navigation/desks-store";
import type { AssistantChatRef } from "./model";
import { assistantDeskChat } from "./mirror";
import { openAssistantDesk } from "./open";
import { useAssistantSidebarStore } from "./store";

const ThemedBot = withUnistyles(Bot);

// English only, like the other custom surfaces.
const presentation = {
  label: () => "Projects Assistant",
  subtitle: () => "The Projects Assistant Desk, mirrored here",
  tooltip: () => "Projects Assistant",
  icon: ThemedBot,
} satisfies PanelPresentation;

const SEPARATOR = "\u0000";
const ignoreRetarget = () => undefined;

/** The chat the assistant Desk shows, as a stable `serverId\0agentId` key (empty when none). */
function useMirrorChatKey(): string {
  return useDesksStore((state) => {
    const chat = assistantDeskChat(state.desks);
    return chat ? `${chat.serverId}${SEPARATOR}${chat.agentId}` : "";
  });
}

function parseChatKey(key: string): AssistantChatRef | null {
  const split = key.indexOf(SEPARATOR);
  if (split < 0) return null;
  return { serverId: key.slice(0, split), agentId: key.slice(split + 1) };
}

function AssistantSidebarPanel() {
  const pane = usePaneContext();
  const chatKey = useMirrorChatKey();
  const chat = useMemo(() => parseChatKey(chatKey), [chatKey]);
  const chatWorkspaceId = useSessionStore((state) =>
    chat ? state.sessions[chat.serverId]?.agents.get(chat.agentId)?.workspaceId : undefined,
  );
  const openDesk = useCallback(() => openAssistantDesk({ chat: null }), []);

  // Keep the remembered chat in step with the Desk, so every other way to the chat opens it too.
  useEffect(() => {
    if (chat) useAssistantSidebarStore.getState().setChat(chat);
  }, [chat]);

  const value = useMemo<PaneContextValue | null>(
    () =>
      chat
        ? {
            ...pane,
            serverId: chat.serverId,
            workspaceId: chatWorkspaceId ?? pane.workspaceId,
            target: { kind: "agent", agentId: chat.agentId },
            // The Desk owns the chat: never turn this Explorer tab into an agent tab.
            retargetCurrentTab: ignoreRetarget,
          }
        : null,
    [chat, chatWorkspaceId, pane],
  );

  if (!value) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          The Projects Assistant Desk has no chat open. Open the Desk to start or pick one.
        </Text>
        <Button
          variant="secondary"
          size="sm"
          onPress={openDesk}
          testID="projects-assistant-open-desk"
        >
          Open Projects Assistant Desk
        </Button>
      </View>
    );
  }
  return (
    <PaneProvider key={chatKey} value={value}>
      <AgentConversationPanel />
    </PaneProvider>
  );
}

export const assistantSidebarPanelRegistration = definePanel("projects_assistant", {
  component: AssistantSidebarPanel,
  presentation,
});

const styles = StyleSheet.create((theme) => ({
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
