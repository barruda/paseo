// CUSTOM(jev-router): the "start over on the model I picked" button of the Jev router's card. The
// restart itself (new session on `model` with the first prompt, opened, the agent archived) lives in
// `useRestartAgent`, shared with the composer's Jev chip.
import { useCallback } from "react";
import { RotateCcw } from "lucide-react-native";
import type { RestartAgentButtonProps } from "@getpaseo/plugin/client/react-native";
import { Button } from "@/components/ui/button";
import { useRestartAgent } from "@/jev-router/use-restart-agent";

export function RestartAgentButton({
  serverId,
  agentId,
  label,
  prompt,
  model,
  thinkingOptionId,
  onBeforeRestart,
  testID,
}: RestartAgentButtonProps) {
  const { restart, busy, ready } = useRestartAgent(serverId, agentId);
  const handlePress = useCallback(
    () =>
      void restart({ prompt, model, thinkingOptionId: thinkingOptionId ?? null, onBeforeRestart }),
    [model, onBeforeRestart, prompt, restart, thinkingOptionId],
  );

  if (!ready) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      leftIcon={RotateCcw}
      onPress={handlePress}
      loading={busy}
      disabled={busy}
      testID={testID}
    >
      {label}
    </Button>
  );
}
