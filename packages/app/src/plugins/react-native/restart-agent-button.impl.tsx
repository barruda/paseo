// CUSTOM(jev-router): the "start over on the model I picked" button of the Jev router's card. It
// creates a session like the agent's on `model` with the first prompt, opens it, and archives the
// agent (archived agents leave the workspace tabs).
import { useCallback, useState } from "react";
import { RotateCcw } from "lucide-react-native";
import type { RestartAgentButtonProps } from "@getpaseo/plugin/client/react-native";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";

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
  const toast = useToast();
  const { archiveAgent } = useArchiveAgent();
  const agent = useSessionStore((state) => state.sessions[serverId]?.agents.get(agentId) ?? null);
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [busy, setBusy] = useState(false);

  const restart = useCallback(async () => {
    if (!agent || !client || busy) return;
    setBusy(true);
    try {
      await onBeforeRestart?.();
      const featureValues = Object.fromEntries(
        (agent.features ?? []).map((feature) => [feature.id, feature.value]),
      );
      const created = await client.createAgent({
        config: {
          provider: agent.provider,
          cwd: agent.cwd,
          ...(agent.currentModeId ? { modeId: agent.currentModeId } : {}),
          model,
          ...(thinkingOptionId ? { thinkingOptionId } : {}),
          featureValues,
        },
        ...(agent.workspaceId ? { workspaceId: agent.workspaceId } : {}),
        initialPrompt: prompt,
      });
      if (agent.workspaceId)
        navigateToWorkspace({
          serverId,
          workspaceId: agent.workspaceId,
          target: { kind: "agent", agentId: created.id },
        });
      await archiveAgent({ serverId, agentId });
    } catch (error) {
      toast.error(toErrorMessage(error));
      setBusy(false);
    }
  }, [
    agent,
    agentId,
    archiveAgent,
    busy,
    client,
    model,
    onBeforeRestart,
    prompt,
    serverId,
    thinkingOptionId,
    toast,
  ]);

  if (!agent) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      leftIcon={RotateCcw}
      onPress={restart}
      loading={busy}
      disabled={busy}
      testID={testID}
    >
      {label}
    </Button>
  );
}
