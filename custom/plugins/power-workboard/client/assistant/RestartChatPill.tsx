// CUSTOM(assistant-restart-pill): a "Restart chat" pill in the composer row of the Projects
// Assistant chat agent only. It confirms, then asks the server for a fresh chat that archives the
// old one, and opens the new agent when the host gives the popover a way to navigate.
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useRpc,
  type PluginButtonContentProps,
  type PluginButtonRegistration,
  type PluginClientContext,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import { assistantChatOpenRpc } from "../../shared/assistant-rpc";
import { ASSISTANT_CHAT_AGENT_LABEL } from "../../shared/reply-protocol";
import { readPaseoLanguage, usePaseoLanguage } from "../paseo-language";
import { openAssistantChat } from "./nav";
import type { Language } from "../strings";

/** The label `CHAT_LABEL` (server/assistant/chat.ts) puts on the chat agent. */
export const ASSISTANT_CHAT_LABEL = ASSISTANT_CHAT_AGENT_LABEL;
export const RESTART_PILL_ID = "restart-chat";

const strings = {
  en: {
    title: "Restart chat",
    restart: "Restart",
    cancel: "Cancel",
    confirm:
      "Starts a new Project Manager conversation. This one is archived and its session is dropped.",
  },
  zh: {
    title: "重启聊天",
    restart: "重启",
    cancel: "取消",
    confirm: "将开始新的项目助手对话。当前对话会被归档，其会话将被丢弃。",
  },
} satisfies Record<Language, Record<string, string>>;

function RestartChatContent(props: PluginButtonContentProps) {
  const { theme, close } = props;
  const s = strings[usePaseoLanguage()];
  const call = useRpc(assistantChatOpenRpc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restart = async () => {
    setBusy(true);
    setError(null);
    try {
      const { agentId } = await call({ fresh: true, archivePrevious: true });
      // Paseo passes button content the same navigation surfaces get (CUSTOM(assistant-restart-pill)
      // in the app); an older app has none, and the new chat is then reachable from the Desk chip.
      // The plugin's pinned @getpaseo/plugin types predate that field, hence the cast.
      // CUSTOM(assistant-desk): the new chat shows in the Project Manager Desk.
      const { navigation } = props as typeof props &
        Pick<PluginSurfaceProps, "navigation">;
      if (navigation) openAssistantChat(navigation, agentId);
      close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  const button = (label: string, onPress: () => void, primary = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          borderColor: primary ? theme.colors.accent : theme.colors.border,
          backgroundColor: primary
            ? theme.colors.accent
            : pressed
              ? theme.colors.surface2
              : "transparent",
          opacity: busy ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: primary
            ? theme.colors.accentForeground
            : theme.colors.foreground,
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
        {s.confirm}
      </Text>
      {error ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 13 }}>
          {error}
        </Text>
      ) : null}
      <View style={styles.row}>
        {button(s.cancel, close)}
        {button(s.restart, () => void restart(), true)}
      </View>
    </View>
  );
}

/**
 * Keeps one pill on every Project Manager chat agent, from an owned agent subscription.
 * Returns the cleanup.
 */
export function contributeRestartChatPill(client: PluginClientContext) {
  const pills = new Map<string, PluginButtonRegistration>();
  let stopped = false;
  const lifetime = new AbortController();
  const remove = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };
  const register = (agent: {
    id: string;
    workspaceId?: string | null;
    labels?: Readonly<Record<string, string>>;
    archivedAt?: string | null;
  }) => {
    if (stopped) return;
    if (
      !agent.workspaceId ||
      agent.archivedAt ||
      !agent.labels?.[ASSISTANT_CHAT_LABEL]
    ) {
      remove(agent.id);
      return;
    }
    if (pills.has(agent.id)) return;
    const title = strings[readPaseoLanguage()].title;
    pills.set(
      agent.id,
      client.addComposerPill({
        id: RESTART_PILL_ID,
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        button: {
          title,
          label: title,
          icon: "RotateCcw",
          behavior: { kind: "popover", Content: RestartChatContent },
        },
      }),
    );
  };
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          for (const pill of pills.values()) pill.remove();
          pills.clear();
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") remove(update.agentId);
          else register(update.agent);
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!stopped)
        console.error("Restart-chat pill observation failed", error);
    });
  return () => {
    stopped = true;
    lifetime.abort();
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 12, maxWidth: 320 },
  row: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  button: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
