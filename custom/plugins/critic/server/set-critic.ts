import { defineAgentTool, type AgentToolDefinition } from "@getpaseo/plugin/server";
import { isCriticAgentLabels, type CriticConfig } from "@getpaseo/protocol/critic";
import {
  applySetCriticInput,
  criticEnabledLabel,
  SetCriticInputSchema,
} from "../shared/set-config";

// CUSTOM(critic): the `set_critic` tool lets the agent itself turn the critic on or off when the
// user asks in the chat. It writes the same store as the sheet's `config.set` and updates the
// `custom.critic.enabled` label, so the composer toggle, the sheet and the notification hold all
// agree.

export interface CriticConfigStore {
  get(agentId: string): Promise<{ config: CriticConfig; isDefault: boolean }>;
  set(input: { agentId: string; config: CriticConfig; saveAsDefault: boolean }): Promise<void>;
}

/** Every interactive agent gets the tool, except the critic agents themselves. */
export function shouldAttachCriticTool(input: {
  purpose: "interactive" | "history";
  labels: Readonly<Record<string, string>>;
}): boolean {
  return input.purpose === "interactive" && !isCriticAgentLabels(input.labels);
}

function describeMode(mode: CriticConfig["mode"]): string {
  return mode === "persistent"
    ? "persistent (one critic for the whole chat)"
    : "per-request (a fresh critic for each user message)";
}

export function createSetCriticTool(store: CriticConfigStore): AgentToolDefinition {
  return defineAgentTool({
    name: "set_critic",
    title: "Turn the critic on or off for this agent",
    description:
      "Turns the Paseo critic (the `critic` plugin) on or off for the agent this tool runs in. " +
      "When it is on, another model reads each of your answers before the user does and can send " +
      "the answer back with feedback. Use it when the user asks to use, enable, disable or stop " +
      "the critic for this agent. It also updates the composer toggle. Do not use it for another " +
      "agent. The result carries the effective model and mode, to confirm them to the user.",
    input: SetCriticInputSchema,
    async execute(input, { agent, paseo }) {
      const { config: current } = await store.get(agent.id);
      const config = applySetCriticInput(current, input);
      await store.set({ agentId: agent.id, config, saveAsDefault: false });
      await paseo.agents.ref(agent.id).update({ labels: criticEnabledLabel(config.enabled) });

      // Plain text only: Claude Code hands the model only `structuredContent` when both are
      // present, and the model has to read the confirmation and the instructions.
      return {
        text: config.enabled
          ? `Critic on for this agent. Model: ${config.provider}/${config.model}. Mode: ${describeMode(config.mode)}. Every answer now goes through the review before the user reads it: end each turn with a complete report (what you changed, how you checked it, what you left out) and fix what a <critic-feedback> message points out.`
          : "Critic off for this agent. Your answers go straight to the user again.",
      };
    },
  });
}
