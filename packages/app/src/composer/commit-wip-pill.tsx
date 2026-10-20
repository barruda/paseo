// CUSTOM(commit-wip): a "Commit: wip" pill right of the diff stat pill. It runs the commit as a
// `!<command>` (shell-command plugin), so the output lands in a Terminal card in the chat. It shows
// always, even with no changes: the diff stat lags behind, and with nothing to commit git just says
// so in the card.
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text } from "react-native";
import { useRunChatCommand } from "@/chat-code-run/context";
import { composerPillStyles } from "@/composer/pill-styles";
import { useToast } from "@/contexts/toast-context";

export const COMMIT_WIP_COMMAND = "git add . && git commit -m 'wip'";
/** Keeps the composer track row up even when it has nothing else to show. */
export const COMMIT_WIP_PILL_ALWAYS_SHOWN = true;

export const CommitWipPill = memo(function CommitWipPill({
  serverId,
  workspaceId,
  agentId,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
}): ReactElement | null {
  const toast = useToast();
  const run = useRunChatCommand({ serverId, workspaceId, agentId, toast });
  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const handlePress = useCallback(() => {
    if (run) run(COMMIT_WIP_COMMAND);
    else toast.error("Commit: wip needs the shell-command plugin on this host");
  }, [run, toast]);
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
      testID="composer-commit-wip-pill"
      accessibilityRole="button"
      accessibilityLabel={`Run ${COMMIT_WIP_COMMAND}`}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={bodyStyle}
    >
      <Text style={labelStyle}>Commit: wip</Text>
    </Pressable>
  );
});
