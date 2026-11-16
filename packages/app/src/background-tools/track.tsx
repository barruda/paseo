// CUSTOM(background-tools): the "N tools" chip next to the subagents pill. Its panel lists the
// agent's live background shells and monitors; a click copies the command.
import * as Clipboard from "expo-clipboard";
import { X } from "lucide-react-native";
import { useCallback, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import type { AgentBackgroundTaskPayload } from "@getpaseo/protocol/messages";
import {
  backgroundToolCopyText,
  backgroundToolKindLabel,
  buildBackgroundToolsSegments,
} from "./presentation";

export function useAgentBackgroundTools(serverId: string, agentId: string) {
  return useSessionStore((state) => state.sessions[serverId]?.agents.get(agentId)?.backgroundTasks);
}

const ThemedX = withUnistyles(X);

export function BackgroundToolsTrack({
  serverId,
  agentId,
  tasks,
}: {
  serverId: string;
  agentId: string;
  tasks: readonly AgentBackgroundTaskPayload[] | undefined;
}): ReactElement | null {
  if (!tasks || tasks.length === 0) return null;
  const segments = buildBackgroundToolsSegments(tasks);
  const label = segments.map((segment) => segment.text).join(", ");
  return (
    <ComposerTrackPill
      testID="background-tools-track-header"
      segments={segments}
      accessibilityLabel={`${label} in the background`}
      panelTitle="Background tools"
    >
      {tasks.map((task) => (
        <BackgroundToolRow key={task.id} serverId={serverId} agentId={agentId} task={task} />
      ))}
    </ComposerTrackPill>
  );
}

function BackgroundToolRow({
  serverId,
  agentId,
  task,
}: {
  serverId: string;
  agentId: string;
  task: AgentBackgroundTaskPayload;
}): ReactElement {
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const supportsStop = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.backgroundTaskStop === true,
  );
  const [stopping, setStopping] = useState(false);
  const handleStop = useCallback(() => {
    if (!client) return;
    setStopping(true);
    client
      .stopAgentBackgroundTask(agentId, task.id)
      .then((stopped) => {
        if (!stopped) toast.error("Could not stop the tool");
        return undefined;
      })
      .catch(() => toast.error("Could not stop the tool"))
      .finally(() => setStopping(false));
  }, [agentId, client, task.id, toast]);
  const kindLabel = backgroundToolKindLabel(task.kind);
  const handlePress = useCallback(() => {
    Clipboard.setStringAsync(backgroundToolCopyText(task))
      .then(() => toast.copied(task.command ? "Command" : "Description"))
      .catch(() => toast.error("Could not copy"));
  }, [task, toast]);
  return (
    <ComposerTrackRow
      accessibilityLabel={`Copy ${kindLabel}: ${task.description}`}
      testID={`background-tools-row-${task.id}`}
      closeOnSelect={false}
      onPress={handlePress}
    >
      {supportsStop && client ? (
        <ToolbarButton
          label={`Stop ${kindLabel}: ${task.description}`}
          compact
          disabled={stopping}
          onPress={handleStop}
          testID={`background-tools-stop-${task.id}`}
        >
          <ThemedX size={14} uniProps={mutedIconColorMapping} />
        </ToolbarButton>
      ) : null}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {kindLabel}
          {task.description ? ` · ${task.description}` : ""}
        </Text>
        {task.command ? (
          <Text style={styles.command} numberOfLines={2}>
            {task.command}
          </Text>
        ) : null}
      </View>
    </ComposerTrackRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  text: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minWidth: 0 },
  title: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
  command: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
  },
}));
