import { z } from "zod";
import {
  CRITIC_ENABLED_LABEL,
  CRITIC_MAX_ROUNDS_LIMIT,
  type CriticConfig,
} from "@getpaseo/protocol/critic";

// CUSTOM(critic): the `set_critic` agent tool edits one field at a time, so an agent can turn its
// own critic on or off without reading and writing the whole config the way the sheet does.

export const SetCriticInputSchema = z.object({
  enabled: z.boolean().describe("true turns the critic on for this agent; false turns it off."),
  model: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Critic model as "provider/model" (for example "claude/claude-sonnet-5-5"). A bare model keeps the current provider.',
    ),
  provider: z
    .string()
    .min(1)
    .optional()
    .describe("Critic provider, when the model string does not carry one."),
  prompt: z
    .string()
    .optional()
    .describe("What the critic should judge the answer against. Replaces the current prompt."),
  mode: z
    .enum(["per-request", "persistent"])
    .optional()
    .describe(
      "per-request: a fresh critic for each user message (default). persistent: one critic for the whole chat.",
    ),
  tools: z
    .enum(["off", "read"])
    .optional()
    .describe("off: judge only what the prompt carries. read: the critic may read the repository."),
  includeDiff: z
    .boolean()
    .optional()
    .describe("Send the workspace's git status and diff to the critic."),
  maxRounds: z
    .number()
    .int()
    .min(1)
    .max(CRITIC_MAX_ROUNDS_LIMIT)
    .optional()
    .describe("How many rejected answers the agent may fix before the last one reaches the user."),
});
export type SetCriticInput = z.infer<typeof SetCriticInputSchema>;

/** Splits "provider/model" at the first slash; a bare model keeps the current provider. */
export function splitCriticModel(
  model: string | undefined,
  provider: string,
): { provider: string; model: string } {
  if (!model) return { provider, model: "" };
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return { provider, model };
  return { provider: model.slice(0, slash), model: model.slice(slash + 1) };
}

/** The next config: the fields in `input` replace the current ones, the rest stay. */
export function applySetCriticInput(current: CriticConfig, input: SetCriticInput): CriticConfig {
  const provider = input.provider ?? current.provider;
  const model = splitCriticModel(input.model, provider);
  return {
    ...current,
    enabled: input.enabled,
    provider: model.provider,
    model: input.model ? model.model : current.model,
    prompt: input.prompt ?? current.prompt,
    mode: input.mode ?? current.mode,
    tools: input.tools ?? current.tools,
    includeDiff: input.includeDiff ?? current.includeDiff,
    maxRounds: input.maxRounds ?? current.maxRounds,
  };
}

/** The composer toggle reads the label; the loop reads the config. Keep both in step. */
export function criticEnabledLabel(enabled: boolean): Record<string, string> {
  return { [CRITIC_ENABLED_LABEL]: enabled ? "true" : "false" };
}
