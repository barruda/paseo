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

/**
 * Model focused: keep the selected model and drop to Sonnet or Haiku only when Jev is sure the task
 * is small (route.py `downgrade_only`). Effort focused: two models, the effort does the rest; Jev
 * puts each first prompt in a bucket (operational, default, hard) and the session starts on that
 * bucket's model and effort, whatever was selected (route.py `effort_focused`).
 */
export const JEV_ROUTER_MODES = ["model", "effort"] as const;
export type JevRouterMode = (typeof JEV_ROUTER_MODES)[number];

/** The levels the router chooses from; it never asks above `high`. */
export const JEV_ROUTER_EFFORTS = ["low", "medium", "high"] as const;

export const JevRouterPickSchema = z.object({ model: z.string(), effort: z.string() });
export type JevRouterPick = z.infer<typeof JevRouterPickSchema>;

export const DEFAULT_JEV_MODEL_FOCUSED = {
  smallThreshold: 0.7,
  hardThreshold: 0.3,
  useSonnet: false,
};

export const JevModelFocusedSchema = z.object({
  /** P(small work) and P(routine reasoning) needed to leave the selected model. */
  smallThreshold: z.number().min(0).max(1).default(DEFAULT_JEV_MODEL_FOCUSED.smallThreshold),
  /** An unknown-cause bug, design or risk signal at or above this keeps the selected model. */
  hardThreshold: z.number().min(0).max(1).default(DEFAULT_JEV_MODEL_FOCUSED.hardThreshold),
  /** Off (default): a small task keeps the selected model; only chat and tiny tasks drop to Haiku. */
  useSonnet: z.boolean().default(DEFAULT_JEV_MODEL_FOCUSED.useSonnet),
});
export type JevModelFocused = z.infer<typeof JevModelFocusedSchema>;

export const DEFAULT_JEV_EFFORT_FOCUSED = {
  operationalModel: "claude-haiku-5-5",
  operationalEfforts: ["low", "medium", "high"],
  defaultPick: { model: "claude-opus-5-5", effort: "low" },
  hardPick: { model: "claude-opus-5-5", effort: "high" },
  smallThreshold: 0.7,
  hardThreshold: 0.3,
  deepThreshold: 0.5,
  lockCycling: true,
};

export const JevEffortFocusedSchema = z.object({
  /** Chat and tiny operational work (search code, an easy merge, an HTML page). */
  operationalModel: z.string().default(DEFAULT_JEV_EFFORT_FOCUSED.operationalModel),
  /** Jev's own effort pick is moved to the nearest of these. */
  operationalEfforts: z
    .array(z.string())
    .min(1)
    .default(DEFAULT_JEV_EFFORT_FOCUSED.operationalEfforts),
  /** Every task that is neither operational nor hard. */
  defaultPick: JevRouterPickSchema.default(DEFAULT_JEV_EFFORT_FOCUSED.defaultPick),
  hardPick: JevRouterPickSchema.default(DEFAULT_JEV_EFFORT_FOCUSED.hardPick),
  /** P(tiny work) and P(routine reasoning) needed for the operational bucket. */
  smallThreshold: z.number().min(0).max(1).default(DEFAULT_JEV_EFFORT_FOCUSED.smallThreshold),
  /** A hard signal at or above this keeps a task out of the operational bucket. */
  hardThreshold: z.number().min(0).max(1).default(DEFAULT_JEV_EFFORT_FOCUSED.hardThreshold),
  /** P(hard or frontier reasoning), or a hard signal, at or above this picks `hardPick`. */
  deepThreshold: z.number().min(0).max(1).default(DEFAULT_JEV_EFFORT_FOCUSED.deepThreshold),
  /** ←/→ in the composer cycle only the models and efforts of the three picks. */
  lockCycling: z.boolean().default(DEFAULT_JEV_EFFORT_FOCUSED.lockCycling),
});
export type JevEffortFocused = z.infer<typeof JevEffortFocusedSchema>;

/** Host settings document (Settings > Plugins > jev-router, and the composer icon's sheet). */
export const JevRouterSettingsSchema = z.object({
  /** On: a small first prompt starts on the cheaper pick. The composer icon flips it. */
  enabled: z.boolean().default(true),
  /** TypeSafe gateway key. Empty: route.py reads TYPESAFE_API_KEY or ~/.config/typesafe/env. */
  apiKey: z.string().default(""),
  routerScript: z.string().trim().min(1).default(DEFAULT_JEV_ROUTER_SCRIPT),
  python: z.string().trim().min(1).default("python3"),
  /** Jev call timeout handed to route.py; the plugin kills the script 3 s after it. */
  timeoutSeconds: z.number().min(0.5).max(10).default(2),
  /** Append each decision to ~/.local/state/jev-router/decisions.jsonl (`route.py review`). */
  logDecisions: z.boolean().default(true),
  mode: z.enum(JEV_ROUTER_MODES).default("model"),
  modelFocused: JevModelFocusedSchema.default(DEFAULT_JEV_MODEL_FOCUSED),
  effortFocused: JevEffortFocusedSchema.default(DEFAULT_JEV_EFFORT_FOCUSED),
});
export type JevRouterSettings = z.infer<typeof JevRouterSettingsSchema>;

export const JevRouteInputSchema = z.object({
  prompt: z.string(),
  cwd: z.string(),
  images: z.number().int().min(0).default(0),
  provider: z.string(),
  model: z.string().nullable(),
  thinkingOptionId: z.string().nullable(),
  /** Settings "Test" button: runs even when disabled, never logs or applies. */
  test: z.boolean().default(false),
});
export type JevRouteInput = z.input<typeof JevRouteInputSchema>;

export const JevDecisionSchema = z.object({
  /** Model family picked: haiku, sonnet, opus or fable. */
  model: z.string(),
  modelId: z.string(),
  effort: z.string(),
  why: z.string(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
  /** Jev's own effort pick (route.py `jev_effort`); the effort-focused operational bucket uses it. */
  jevEffort: z.string().nullable().optional(),
});
export type JevDecision = z.infer<typeof JevDecisionSchema>;

export const JevRouteOutputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("skipped"), reason: z.string() }),
  z.object({
    status: z.literal("routed"),
    decision: JevDecisionSchema,
    /** `family/effort` the session would start on without routing. */
    home: z.string(),
    /** Set when the pick is applied (model focused: cheaper than home; effort focused: different). */
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
  /** Set when applied: the plugin's `agent.created` hook finds the stashed prompt by it. */
  routeId: "custom.jev.route-id",
} as const;

/** The short card the plugin appends to a session whose model Jev changed. */
export const JEV_TIMELINE_KIND = "jev-route";
export const JEV_TIMELINE_VERSION = 1;

export const JevRouteCardDataSchema = z.object({
  /** Model id and effort the session started on. */
  pickModelId: z.string(),
  pickEffort: z.string(),
  why: z.string(),
  /** What the user had selected: the restart button starts a new session on it. */
  homeModelId: z.string(),
  homeThinkingOptionId: z.string().nullable(),
  /** The first prompt, resent by the restart button; null when too long to keep in the row. */
  prompt: z.string().nullable(),
});
export type JevRouteCardData = z.infer<typeof JevRouteCardDataSchema>;

/** Readable name of a Claude model id: `claude-opus-4-8[1m]` → `Opus 4.8 [1m]`. */
export function formatClaudeModel(modelId: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(\[[^\]]+\])?$/.exec(modelId);
  if (!match) return modelId;
  const [, family = "", major, minor, suffix] = match;
  const name = `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ""}`;
  return suffix ? `${name} ${suffix}` : name;
}

function effortRank(effort: string): number {
  const index = (JEV_ROUTER_EFFORTS as readonly string[]).indexOf(effort);
  return index < 0 ? JEV_ROUTER_EFFORTS.length : index;
}

/** The allowed effort closest to `wanted` (ties go to the lower one); the first when unknown. */
export function nearestEffort(
  allowed: readonly string[],
  wanted: string | null | undefined,
): string {
  const sorted = [...allowed].sort((a, b) => effortRank(a) - effortRank(b));
  if (!wanted) return sorted[0] ?? "low";
  const target = effortRank(wanted);
  let best = sorted[0] ?? "low";
  for (const effort of sorted) {
    if (Math.abs(effortRank(effort) - target) < Math.abs(effortRank(best) - target)) best = effort;
  }
  return best;
}

/**
 * Effort focused: the model and effort a route.py bucket (`why`) starts on. Chat and operational go
 * to the operational model (chat on its lowest effort, operational on Jev's effort moved to the
 * nearest allowed one), hard to `hardPick`, everything else to `defaultPick`.
 */
export function effortFocusedPick(
  config: JevEffortFocused,
  why: string,
  jevEffort: string | null | undefined,
): JevRouterPick {
  if (why === "chat")
    return {
      model: config.operationalModel,
      effort: nearestEffort(config.operationalEfforts, "low"),
    };
  if (why === "operational")
    return {
      model: config.operationalModel,
      effort: nearestEffort(config.operationalEfforts, jevEffort),
    };
  if (why === "hard") return config.hardPick;
  return config.defaultPick;
}

/** Effort focused with the lock on: each model ←/→ may land on, with its efforts in level order. */
export function effortFocusedCycle(
  config: JevEffortFocused,
): { model: string; efforts: string[] }[] {
  const byModel = new Map<string, Set<string>>();
  const add = (model: string, efforts: readonly string[]) => {
    const set = byModel.get(model) ?? new Set<string>();
    for (const effort of efforts) set.add(effort);
    byModel.set(model, set);
  };
  add(config.operationalModel, config.operationalEfforts);
  add(config.defaultPick.model, [config.defaultPick.effort]);
  add(config.hardPick.model, [config.hardPick.effort]);
  return [...byModel].map(([model, efforts]) => ({
    model,
    efforts: [...efforts].sort((a, b) => effortRank(a) - effortRank(b)),
  }));
}
