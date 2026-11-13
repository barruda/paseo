// CUSTOM(background-tools): the "N tools" chip next to the subagents pill. Its panel lists the
// agent's live background shells and monitors; a click copies the command.
import * as Clipboard from "expo-clipboard";
import { useCallback, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import type { AgentBackgroundTaskPayload } from "@getpaseo/protocol/messages";
import {
  backgroundToolCopyText,
  backgroundToolKindLabel,
  formatBackgroundToolCount,
} from "./presentation";

export function useAgentBackgroundTools(serverId: string, agentId: string) {
  return useSessionStore((state) => state.sessions[serverId]?.agents.get(agentId)?.backgroundTasks);
}

export function BackgroundToolsTrack({
  tasks,
}: {
  tasks: readonly AgentBackgroundTaskPayload[] | undefined;
}): ReactElement | null {
  if (!tasks || tasks.length === 0) return null;
  const label = formatBackgroundToolCount(tasks.length);
  return (
    <ComposerTrackPill
      testID="background-tools-track-header"
      segments={[{ bucket: "running", text: label }]}
      accessibilityLabel={`${label} running in the background`}
      panelTitle="Background tools"
    >
      {tasks.map((task) => (
        <BackgroundToolRow key={task.id} task={task} />
      ))}
    </ComposerTrackPill>
  );
}

function BackgroundToolRow({ task }: { task: AgentBackgroundTaskPayload }): ReactElement {
  const toast = useToast();
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
