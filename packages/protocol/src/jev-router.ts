import { z } from "zod";

// CUSTOM(jev-router): shared by the `jev-router` plugin (custom/plugins/jev-router) and the app's
// composer toggle and draft submit (packages/app/src/jev-router). Before a new Claude session
// starts, the plugin asks gnome-custom's jev-router/route.py (TypeSafe Jev) whether its first prompt
// is small enough to start on a cheaper model. It never picks a model stronger than the selected one.

export const JEV_ROUTER_PLUGIN_ID = "jev-router";
export const JEV_ROUTER_SETTINGS_ID = "router";

export const JEV_ROUTER_RPC = {
  route: "route",
} as const;

export const DEFAULT_JEV_ROUTER_SCRIPT = "~/projetos/gnome-custom/jev-router/route.py";

/** Host settings document (Settings > Plugins > jev-router). */
export const JevRouterSettingsSchema = z.object({
  /** Off: no routing call, no composer icon. */
  enabled: z.boolean().default(false),
  /** Off is shadow mode: the decision is logged and labeled, the session starts as selected. */
  apply: z.boolean().default(false),
  /** TypeSafe gateway key. Empty: route.py reads TYPESAFE_API_KEY or ~/.config/typesafe/env. */
  apiKey: z.string().default(""),
  routerScript: z.string().trim().min(1).default(DEFAULT_JEV_ROUTER_SCRIPT),
  python: z.string().trim().min(1).default("python3"),
  /** Jev call timeout handed to route.py; the plugin kills the script 3 s after it. */
  timeoutSeconds: z.number().min(0.5).max(10).default(2),
  /** Append each decision to ~/.local/state/jev-router/decisions.jsonl (`route.py review`). */
  logDecisions: z.boolean().default(true),
});
export type JevRouterSettings = z.infer<typeof JevRouterSettingsSchema>;

export const JevRouteInputSchema = z.object({
  prompt: z.string(),
  cwd: z.string(),
  images: z.number().int().min(0).default(0),
  provider: z.string(),
  model: z.string().nullable(),
  thinkingOptionId: z.string().nullable(),
  /** Settings "Test" button: runs even when disabled, never logs. */
  test: z.boolean().default(false),
});
export type JevRouteInput = z.input<typeof JevRouteInputSchema>;

export const JevDecisionSchema = z.object({
  /** Model family route.py picked: haiku, sonnet, opus or fable. */
  model: z.string(),
  modelId: z.string(),
  effort: z.string(),
  why: z.string(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
});
export type JevDecision = z.infer<typeof JevDecisionSchema>;

export const JevRouteOutputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("skipped"), reason: z.string() }),
  z.object({
    status: z.literal("routed"),
    decision: JevDecisionSchema,
    /** `family/effort` the session would start on without routing. */
    home: z.string(),
    /** Set when the pick is cheaper than home; applied only when `applied` is true. */
    model: z.string().nullable(),
    thinkingOptionId: z.string().nullable(),
    applied: z.boolean(),
    labels: z.record(z.string(), z.string()),
  }),
]);
export type JevRouteOutput = z.infer<typeof JevRouteOutputSchema>;

/** Labels the app puts on the created agent, so its composer icon can tell what happened. */
export const JEV_LABELS = {
  pick: "custom.jev.pick",
  home: "custom.jev.home",
  why: "custom.jev.why",
  applied: "custom.jev.applied",
} as const;
