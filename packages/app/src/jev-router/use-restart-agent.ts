// CUSTOM(jev-router): starts an agent over on another model. It creates a session like the agent's
// (provider, folder, mode, features) on `model`/`thinkingOptionId` with `prompt` as its first
// message, opens it, and archives the agent (archived agents leave the workspace tabs). Used by the
// router card's button (plugins) and the composer's Jev chip.

import { useCallback, useState } from "react";
import { useToast } from "@/contexts/toast-context";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";

export interface RestartAgentRequest {
  prompt: string;
  model: string;
  thinkingOptionId: string | null;
  /** Runs first; throwing cancels the restart and shows the error. */
  onBeforeRestart?: () => Promise<void> | void;
}

export function useRestartAgent(serverId: string, agentId: string) {
  const toast = useToast();
  const { archiveAgent } = useArchiveAgent();
  const agent = useSessionStore((state) => state.sessions[serverId]?.agents.get(agentId) ?? null);
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [busy, setBusy] = useState(false);

  const restart = useCallback(
    async (request: RestartAgentRequest) => {
      if (!agent || !client || busy) return;
      setBusy(true);
      try {
        await request.onBeforeRestart?.();
        const featureValues = Object.fromEntries(
          (agent.features ?? []).map((feature) => [feature.id, feature.value]),
        );
        const created = await client.createAgent({
          config: {
            provider: agent.provider,
            cwd: agent.cwd,
            ...(agent.currentModeId ? { modeId: agent.currentModeId } : {}),
            model: request.model,
            ...(request.thinkingOptionId ? { thinkingOptionId: request.thinkingOptionId } : {}),
            featureValues,
          },
          ...(agent.workspaceId ? { workspaceId: agent.workspaceId } : {}),
          initialPrompt: request.prompt,
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
    },
    [agent, agentId, archiveAgent, busy, client, serverId, toast],
  );

  return { restart, busy, ready: agent !== null && client !== null };
}
