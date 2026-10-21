// CUSTOM(session-auto-rename): a "Rename session" pill right of Commit: wip. It names the session
// with the title from the agent's status summary (agent-status-summary.ts on the daemon), the same
// title the daemon applies by itself at the third user message.
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text } from "react-native";
import { useAgentStatusSummary } from "@/composer/agent-status-line";
import { composerPillStyles } from "@/composer/pill-styles";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

export const RenameSessionPill = memo(function RenameSessionPill({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}): ReactElement | null {
  const toast = useToast();
  const summary = useAgentStatusSummary(serverId, agentId);
  // Summaries from before the title existed fall back to the topic.
  const title = summary?.title ?? summary?.topic ?? null;
  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const handlePress = useCallback(() => {
    if (!title) {
      toast.error("No summary yet: send the agent a message first");
      return;
    }
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      toast.error("Host is disconnected");
      return;
    }
    client
      .updateAgent(agentId, { name: title })
      .then(() => toast.show(`Renamed to “${title}”`, { variant: "success" }))
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "Rename failed"),
      );
  }, [agentId, serverId, title, toast]);
  const bodyStyle = useMemo(
    () => [composerPillStyles.body, isHovered && composerPillStyles.bodyActive],
    [isHovered],
  );
  const labelStyle = useMemo(
    () => [composerPillStyles.label, isHovered && composerPillStyles.labelActive],
    [isHovered],
  );

  return (
    <Pressable
      testID="composer-rename-session-pill"
      accessibilityRole="button"
      accessibilityLabel={title ? `Rename session to ${title}` : "Rename session"}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={bodyStyle}
    >
      <Text style={labelStyle}>Rename session</Text>
    </Pressable>
  );
});
