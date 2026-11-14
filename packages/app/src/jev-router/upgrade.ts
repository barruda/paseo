// CUSTOM(jev-router): "Upgrade effort mid-session". Before a follow-up message goes to an idle
// Claude agent, ask the host's jev-router plugin whether it is hard; if so, raise the agent's
// effort (never lower it, never change the model) the way the effort chip does, and count Jev's
// tokens in the agent's labels. Fail-open: it never throws and never blocks the send for long.

import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  JEV_ROUTER_PLUGIN_ID,
  JEV_ROUTER_RPC,
  JevUpgradeOutputSchema,
  addJevUsage,
  needsUpgradeCheck,
  type JevRouterSettings,
} from "@getpaseo/protocol/jev-router";
import { resolveAgentModelSelection } from "@/composer/agent-controls/utils";
import { createAgentPreferencesService } from "@/create-agent-preferences/service";
import { mergeProviderPreferences } from "@/create-agent-preferences/preferences";
import { providersSnapshotQueryKey } from "@/data/providers-snapshot";
import { queryClient } from "@/data/query-client";
import { pluginRegistry } from "@/plugins/registry";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import type { AgentModelDefinition, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { useJevRouterSettingsStore } from "./cycle";

const FORM_PREFERENCES_QUERY_KEY = ["form-preferences"];

export type UpgradeClient = Pick<DaemonClient, "setAgentThinkingOption" | "updateAgent">;

/** What the effort chip does: remember the effort for the model, then change the agent. */
export async function setAgentEffort(input: {
  client: Pick<DaemonClient, "setAgentThinkingOption">;
  agentId: string;
  provider?: string;
  modelId: string | null;
  effort: string;
}): Promise<void> {
  const provider = input.provider ?? "claude";
  if (input.modelId) {
    try {
      const next = await createAgentPreferencesService.update((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider,
          updates: { model: input.modelId!, thinkingByModel: { [input.modelId!]: input.effort } },
        }),
      );
      queryClient.setQueryData(FORM_PREFERENCES_QUERY_KEY, next);
    } catch (error) {
      console.warn("[jev-router] persist thinking preference failed", error);
    }
  }
  await input.client.setAgentThinkingOption(input.agentId, input.effort);
}

interface UpgradeSubject {
  provider: string;
  cwd: string;
  modelId: string | null;
  effort: string | null;
  availableEfforts: string[];
  labels: Record<string, string>;
}

function readUpgradeSubject(serverId: string, agentId: string): UpgradeSubject | null {
  const session = useSessionStore.getState().sessions[serverId];
  const agent = session?.agents.get(agentId);
  if (!session || !agent || agent.provider !== "claude") return null;
  if (selectAgentTurnPresentation(session, agentId).isActive) return null;
  const snapshot = queryClient.getQueryData<{ entries?: ProviderSnapshotEntry[] }>(
    providersSnapshotQueryKey(serverId, agent.cwd),
  );
  const entry = snapshot?.entries?.find((item) => item.provider === agent.provider);
  const models: AgentModelDefinition[] | null = filterSelectableModels(entry?.models ?? null);
  // The same resolution the composer's effort chip uses for its current value and options.
  const selection = resolveAgentModelSelection({
    models,
    runtimeModelId: agent.runtimeInfo?.model ?? null,
    configuredModelId: agent.model,
    runtimeThinkingOptionId: agent.runtimeInfo?.thinkingOptionId ?? null,
    explicitThinkingOptionId: agent.thinkingOptionId,
  });
  return {
    provider: agent.provider,
    cwd: agent.cwd,
    modelId: agent.runtimeInfo?.model ?? agent.model ?? null,
    effort: selection.selectedThinkingId ?? agent.thinkingOptionId ?? null,
    availableEfforts: (selection.thinkingOptions ?? []).map((option) => option.id),
    labels: agent.labels,
  };
}

/**
 * Called by the composer before a follow-up is sent. Resolves quickly (no call) when the setting is
 * off or the agent can't go higher; otherwise waits for Jev, at most the host's timeout + 4 s.
 */
export async function upgradeEffortBeforeSend(input: {
  serverId: string;
  agentId: string;
  client: UpgradeClient;
  prompt: string;
  images: number;
}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const settings: JevRouterSettings | undefined =
      useJevRouterSettingsStore.getState().byServer[input.serverId];
    if (!settings?.upgradeEffort.enabled || !input.prompt.trim()) return;
    const subject = readUpgradeSubject(input.serverId, input.agentId);
    if (!subject?.effort) return;
    if (
      !needsUpgradeCheck({
        setting: settings.upgradeEffort,
        currentEffort: subject.effort,
        availableEfforts: subject.availableEfforts,
      })
    )
      return;
    const plugin = pluginRegistry
      .getSnapshot()
      .find((item) => item.serverId === input.serverId && item.id === JEV_ROUTER_PLUGIN_ID);
    if (!plugin) return;
    const output = await Promise.race([
      plugin.invoke(JEV_ROUTER_RPC.upgrade, {
        agentId: input.agentId,
        prompt: input.prompt,
        cwd: subject.cwd,
        images: input.images,
        provider: subject.provider,
        model: subject.modelId,
        thinkingOptionId: subject.effort,
        availableEfforts: subject.availableEfforts,
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), settings.timeoutSeconds * 1000 + 4000);
      }),
    ]);
    const parsed = JevUpgradeOutputSchema.safeParse(output);
    if (!parsed.success || parsed.data.status !== "checked") return;
    const result = parsed.data;
    // Only this agent: an automatic raise must not become the saved effort new sessions start on.
    if (result.upgraded && result.to) {
      await input.client.setAgentThinkingOption(input.agentId, result.to);
    }
    if (result.decision.usage) {
      // update_agent merges labels, but the app's copy may be a moment stale: add to the latest.
      const latest =
        useSessionStore.getState().sessions[input.serverId]?.agents.get(input.agentId)?.labels ??
        subject.labels;
      await input.client.updateAgent(input.agentId, {
        labels: addJevUsage(latest, result.decision.usage),
      });
    }
  } catch (error) {
    console.warn("[jev-router] effort upgrade failed; sending as is", error);
  } finally {
    clearTimeout(timer);
  }
}
