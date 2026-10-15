import {
  AudioLines,
  Ear,
  EarOff,
  MessageSquare,
  Mic,
  MicOff,
  Square,
  X,
} from "lucide-react-native";
import { useMemo } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { VoiceRuntimeSnapshot } from "@/voice/voice-runtime";
import type { SidebarVoiceSnapshot } from "./session";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { Button } from "@/components/ui/button";
import { useVoiceOptional } from "@/contexts/voice-context";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useAgentFormState } from "@/hooks/use-agent-form-state";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useSidebarVoice } from "./provider";
import { ownsSidebarVoice } from "./session";

// CUSTOM(sidebar-voice): controls stay outside every workspace and conversation tab.
export function SidebarVoiceRow() {
  const { session, snapshot } = useSidebarVoice();
  const voice = useVoiceOptional();
  const localServerId = useLocalDaemonServerId();
  const activeWorkspace = useActiveWorkspaceSelection();
  const serverId = snapshot.target?.serverId ?? localServerId ?? activeWorkspace?.serverId ?? null;
  const form = useAgentFormState({ serverId, workingDir: "~" });
  const active = voice !== null && ownsSidebarVoice(snapshot.target, voice);
  const busy = snapshot.operation !== "idle";
  const status = voiceStatus({
    snapshot,
    voice,
    active,
    serverId,
    hasProvider: Boolean(form.selectedProvider),
  });
  const trailing = useMemo(
    () => <Text style={[styles.status, active && styles.active]}>{status}</Text>,
    [active, status],
  );
  const exit = useStableEvent(() => {
    session.exit();
  });
  const stop = useStableEvent(() => {
    void session.stopAndInterrupt();
  });
  const openConversation = useStableEvent(() => {
    if (snapshot.target) navigateToAgent(snapshot.target);
  });

  const toggle = useStableEvent(() => {
    if (busy) return;
    if (active) {
      session.exit();
      return;
    }
    if (!serverId || !form.selectedProvider) return;
    void session.start(serverId, {
      provider: form.selectedProvider,
      cwd: "~",
      model: form.selectedModel || undefined,
      modeId: form.selectedMode || undefined,
      thinkingOptionId: form.selectedThinkingOptionId || undefined,
    });
  });

  return (
    <View testID="sidebar-voice-section">
      <SidebarHeaderRow
        icon={AudioLines}
        label="Voice"
        variant="compact"
        onPress={toggle}
        isActive={active}
        testID="sidebar-voice"
        accessibilityLabel={`Voice: ${status}. Independent voice session.`}
        trailing={trailing}
      />
      {active && voice ? (
        <View style={styles.controls}>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={voice.isMuted ? MicOff : Mic}
            disabled={busy}
            onPress={voice.toggleMute}
            accessibilityLabel={voice.isMuted ? "Unmute voice microphone" : "Mute voice microphone"}
          />
          <Button
            size="sm"
            variant="ghost"
            leftIcon={voice.isReplyMuted ? EarOff : Ear}
            disabled={busy}
            onPress={voice.toggleReplyMute}
            accessibilityLabel={voice.isReplyMuted ? "Unmute voice replies" : "Mute voice replies"}
          />
          <Button
            size="sm"
            variant="ghost"
            leftIcon={Square}
            disabled={busy}
            onPress={stop}
            accessibilityLabel="Exit voice and interrupt response"
          />
          <Button
            size="sm"
            variant="ghost"
            leftIcon={X}
            disabled={busy}
            onPress={exit}
            accessibilityLabel="Exit voice without interrupting"
          />
        </View>
      ) : null}
      {snapshot.target ? (
        <View style={styles.details}>
          <Button size="sm" variant="ghost" leftIcon={MessageSquare} onPress={openConversation}>
            Voice conversation
          </Button>
        </View>
      ) : null}
      {snapshot.error || form.modelError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {snapshot.error ?? form.modelError}
        </Text>
      ) : null}
    </View>
  );
}

function voiceStatus({
  snapshot,
  voice,
  active,
  serverId,
  hasProvider,
}: {
  snapshot: SidebarVoiceSnapshot;
  voice: VoiceRuntimeSnapshot | null;
  active: boolean;
  serverId: string | null;
  hasProvider: boolean;
}): string {
  let status = "Start";
  if (!serverId) status = "No host";
  else if (!hasProvider) status = "Loading";
  if (active && voice) {
    status = "Listening";
    if (voice.isMuted) status = "Mic muted";
    else if (voice.phase === "playing") status = "Speaking";
    else if (voice.phase === "waiting") status = "Thinking";
  }
  if (snapshot.operation === "starting") status = "Starting…";
  if (snapshot.operation === "stopping") status = "Leaving…";
  if (snapshot.operation === "interrupting") status = "Stopping…";
  if (snapshot.error) status = "Retry";

  return status;
}

const styles = StyleSheet.create((theme) => ({
  status: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  active: { color: theme.colors.statusDotSuccess },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  details: { paddingHorizontal: theme.spacing[2] },
  error: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
}));
