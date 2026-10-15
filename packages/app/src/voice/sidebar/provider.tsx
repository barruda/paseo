import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { randomUUID } from "expo-crypto";
import { useVoiceRuntimeOptional } from "@/contexts/voice-context";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { createSidebarVoiceSession } from "./session";
import { createSidebarVoiceHost } from "./host";

const SidebarVoiceContext = createContext<ReturnType<typeof createSidebarVoiceSession> | null>(
  null,
);

function connectedClient(serverId: string) {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client?.isConnected) throw new Error("Voice host is disconnected. Reconnect and try again.");
  return client;
}

export function SidebarVoiceProvider({ children }: { children: ReactNode }) {
  const voice = useVoiceRuntimeOptional();
  const [session] = useState(() => {
    if (!voice) throw new Error("Sidebar voice requires VoiceProvider");
    const resolveAgent = createSidebarVoiceHost(randomUUID);
    return createSidebarVoiceSession({
      voice,
      now: Date.now,
      resolveAgent: (serverId, config) => resolveAgent(connectedClient(serverId), serverId, config),
      cancelAgent: async (target) => connectedClient(target.serverId).cancelAgent(target.agentId),
    });
  });
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const target = snapshot.target;
  const client = useHostRuntimeClient(target?.serverId ?? "");
  useEffect(() => {
    if (!target || !client || !voice) return;
    // CUSTOM(sidebar-voice): turn completion must arrive even when this agent has no open tab.
    return client.subscribeAgentTimeline(target.agentId, (message) => {
      if (message.type !== "agent_stream") return;
      const type = message.payload.event.type;
      if (
        type === "turn_started" ||
        type === "turn_completed" ||
        type === "turn_failed" ||
        type === "turn_canceled"
      )
        voice.onTurnEvent(target.serverId, target.agentId, type);
    });
  }, [client, target, voice]);
  useKeyboardActionHandler({
    handlerId: "sidebar-voice",
    actions: ["message-input.voice-exit", "agent.interrupt"],
    priority: 10000,
    enabled: true,
    handle: (action) =>
      action.id === "message-input.voice-exit"
        ? session.exit() || session.interruptAfterExit()
        : session.interruptAfterExit(),
  });
  return <SidebarVoiceContext.Provider value={session}>{children}</SidebarVoiceContext.Provider>;
}

export function useSidebarVoice() {
  const session = useContext(SidebarVoiceContext);
  if (!session) throw new Error("SidebarVoiceProvider is missing");
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  return { session, snapshot };
}
