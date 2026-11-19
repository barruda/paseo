// CUSTOM(assistant-sidebar): the Projects Assistant tab of the Explorer sidebar. It shows the live
// assistant chat with the ordinary agent panel (history, composer, pwb cards), so a compaction or a
// restart swaps the chat inside the same tab. See custom/CHANGES.md.
import { useCallback, useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Bot } from "lucide-react-native";
import { AgentConversationPanel } from "@/panels/agent-panel";
import { PaneProvider, usePaneContext, type PaneContextValue } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { resolveAssistantChat, type AssistantAgentFacts, type AssistantChatRef } from "./model";
import { useAssistantSidebarStore } from "./store";

const ThemedBot = withUnistyles(Bot);

// English only, like the other custom surfaces.
const presentation = {
  label: () => "Projects Assistant",
  subtitle: () => "Power Workboard's assistant chat",
  tooltip: () => "Projects Assistant",
  icon: ThemedBot,
} satisfies PanelPresentation;

const SEPARATOR = "\u0000";

/** The chat to show, as a stable `serverId\0agentId` key (empty when there is none). */
function useAssistantChatKey(preferredServerId: string): string {
  const remembered = useAssistantSidebarStore((state) => state.chat);
  return useSessionStore((state) => {
    const agentsByServer = new Map<string, ReadonlyMap<string, AssistantAgentFacts>>();
    const hydratedServerIds = new Set<string>();
    for (const [serverId, session] of Object.entries(state.sessions)) {
      agentsByServer.set(serverId, session.agents);
      if (session.hasHydratedAgents) hydratedServerIds.add(serverId);
    }
    const chat = resolveAssistantChat({
      remembered,
      agentsByServer,
      preferredServerId,
      hydratedServerIds,
    });
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
  const chatKey = useAssistantChatKey(pane.serverId);
  const chat = useMemo(() => parseChatKey(chatKey), [chatKey]);
  const chatWorkspaceId = useSessionStore((state) =>
    chat ? state.sessions[chat.serverId]?.agents.get(chat.agentId)?.workspaceId : undefined,
  );

  // Remember the successor or fallback, so the next start shows it straight away.
  useEffect(() => {
    if (chat) useAssistantSidebarStore.getState().setChat(chat);
  }, [chat]);

  // The agent panel retargets its tab when the conversation moves to another agent; here that
  // means another chat in the same tab. Anything else (a client slash command's fresh draft) would
  // turn this tab into an ordinary one, so it is ignored: Restart chat starts a new chat.
  const retargetCurrentTab = useCallback(
    (target: WorkspaceTabTarget) => {
      if (target.kind !== "agent" || !chat) return;
      useAssistantSidebarStore
        .getState()
        .setChat({ serverId: chat.serverId, agentId: target.agentId });
    },
    [chat],
  );

  const value = useMemo<PaneContextValue | null>(
    () =>
      chat
        ? {
            ...pane,
            serverId: chat.serverId,
            workspaceId: chatWorkspaceId ?? pane.workspaceId,
            target: { kind: "agent", agentId: chat.agentId },
            retargetCurrentTab,
          }
        : null,
    [chat, chatWorkspaceId, pane, retargetCurrentTab],
  );

  if (!value) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          No Projects Assistant chat yet. Open one from Power Workboard, on its Assistant tab.
        </Text>
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
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
