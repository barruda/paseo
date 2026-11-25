import { z } from "zod";

// CUSTOM(pi-models): shared by the `pi-models` plugin (custom/plugins/pi-models), which reads and
// writes Pi's own `models.json` (`$PI_CODING_AGENT_DIR` or ~/.pi/agent), and the editor on the Pi
// provider page (packages/app/src/pi-models). Paseo only shows the models `pi` lists; this is where
// a custom endpoint's URL, key, API and thinking levels live.

export const PI_MODELS_PLUGIN_ID = "pi-models";

export const PI_MODELS_RPC = {
  read: "read",
  write: "write",
  test: "test",
} as const;

/** Pi's thinking levels, in order. `--thinking` and `thinkingLevelMap` use these keys. */
export const PI_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

/** The `api` values Pi documents for custom providers; the field takes any string. */
export const PI_KNOWN_APIS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;

export const PiModelsReadInputSchema = z.object({});

export const PiModelsReadOutputSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  /** The file as stored; "" when it does not exist. */
  text: z.string(),
  /** Hash of `text`; `write` refuses when the file changed since. */
  revision: z.string(),
  /** What `pi --list-models` prints, or why it failed. */
  listing: z.string(),
});
export type PiModelsReadOutput = z.infer<typeof PiModelsReadOutputSchema>;

export const PiModelsWriteInputSchema = z.object({
  text: z.string(),
  baseRevision: z.string(),
});

export const PiModelsWriteOutputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), file: PiModelsReadOutputSchema }),
  z.object({ status: z.literal("conflict"), file: PiModelsReadOutputSchema }),
  z.object({ status: z.literal("invalid"), message: z.string() }),
]);
export type PiModelsWriteOutput = z.infer<typeof PiModelsWriteOutputSchema>;

export const PiModelsTestInputSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  thinking: z.string().optional(),
});

export const PiModelsTestOutputSchema = z.object({
  ok: z.boolean(),
  /** The reply, or the error Pi printed. */
  output: z.string(),
  ms: z.number(),
});
export type PiModelsTestOutput = z.infer<typeof PiModelsTestOutputSchema>;
