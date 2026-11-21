// CUSTOM(assistant-desk), CUSTOM(pm-sidebar): the Project Manager tab of the Explorer sidebar, the
// chat's default place. It renders the chat (assistantSidebarChat) with the ordinary agent panel
// (history, composer, pwb cards), so a new chat, a compaction or a restart swaps the chat in the
// same Explorer tab. "Open in main area" opens the assistant Desk; nothing else does. See
// custom/CHANGES.md.
import { useCallback, useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Bot, SquareArrowOutUpRight } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { AgentConversationPanel } from "@/panels/agent-panel";
import { PaneProvider, usePaneContext, type PaneContextValue } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import { useDesksStore } from "@/task-navigation/desks-store";
import { resolveAssistantChat, type AssistantChatRef } from "./model";
import { assistantSidebarChat } from "./mirror";
import { openAssistantDesk } from "./open";
import { assistantAgentMaps } from "./session-agent-maps";
import { useAssistantSidebarStore } from "./store";
import { assistantDeskStrings } from "./strings";

const ThemedBot = withUnistyles(Bot);

// English only, like the other custom surfaces.
const presentation = {
  label: () => "Project Manager",
  subtitle: () => "The Project Manager chat",
  tooltip: () => "Project Manager",
  icon: ThemedBot,
} satisfies PanelPresentation;

const SEPARATOR = "\u0000";
const ignoreRetarget = () => undefined;

function chatKeyOf(chat: AssistantChatRef | null): string {
  return chat ? `${chat.serverId}${SEPARATOR}${chat.agentId}` : "";
}

/** The chat this tab shows, as a stable `serverId\0agentId` key (empty when none). */
function useMirrorChatKey(): string {
  const remembered = useAssistantSidebarStore((state) => state.chat);
  // assistantAgentMaps returns the same snapshot until an agents map is replaced.
  const maps = useSessionStore((state) => assistantAgentMaps(state.sessions));
  const currentKey = useMemo(
    () =>
      chatKeyOf(
        resolveAssistantChat({
          remembered,
          agentsByServer: maps.agentsByServer,
          preferredServerId: null,
          hydratedServerIds: maps.hydratedServerIds,
        }),
      ),
    [maps, remembered],
  );
  return useDesksStore((state) =>
    chatKeyOf(assistantSidebarChat(state.desks, parseChatKey(currentKey))),
  );
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
  const { i18n } = useTranslation();
  const strings = assistantDeskStrings(i18n.resolvedLanguage);
  const openDesk = useCallback(() => openAssistantDesk({ chat: chat ?? null }), [chat]);

  // Keep the remembered chat in step with what this tab shows, so every other way opens it too.
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
            // Never turn this Explorer tab into an agent tab.
            retargetCurrentTab: ignoreRetarget,
          }
        : null,
    [chat, chatWorkspaceId, pane],
  );

  const openInMain = (
    <View style={styles.bar}>
      <Button
        variant="ghost"
        size="xs"
        leftIcon={SquareArrowOutUpRight}
        onPress={openDesk}
        testID="projects-assistant-open-main"
      >
        {strings.openInMain}
      </Button>
    </View>
  );
  if (!value) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{strings.noChat}</Text>
        <Button
          variant="secondary"
          size="sm"
          onPress={openDesk}
          testID="projects-assistant-open-desk"
        >
          {strings.openInMain}
        </Button>
      </View>
    );
  }
  return (
    <View style={styles.root}>
      {openInMain}
      <View style={styles.chat}>
        <PaneProvider key={chatKey} value={value}>
          <AgentConversationPanel />
        </PaneProvider>
      </View>
    </View>
  );
}

export const assistantSidebarPanelRegistration = definePanel("projects_assistant", {
  component: AssistantSidebarPanel,
  presentation,
});

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
  },
  bar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  chat: {
    flex: 1,
    minHeight: 0,
  },
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
