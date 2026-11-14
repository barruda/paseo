import { z } from "zod";

// CUSTOM(jev-router): shared by the `jev-router` plugin (custom/plugins/jev-router) and the app's
// composer toggle and draft submit (packages/app/src/jev-router). Before a new Claude session
// starts, the plugin asks gnome-custom's jev-router/route.py (TypeSafe Jev) whether its first prompt
// is small enough to start on a cheaper model. It never picks a model stronger than the selected one.

export const JEV_ROUTER_PLUGIN_ID = "jev-router";
export const JEV_ROUTER_SETTINGS_ID = "router";

export const JEV_ROUTER_RPC = {
  route: "route",
  upgrade: "upgrade",
} as const;

export const DEFAULT_JEV_ROUTER_SCRIPT = "~/projetos/gnome-custom/jev-router/route.py";

/** jev.py's own defaults, shown as placeholders when a host leaves its provider fields empty. */
export const DEFAULT_TYPESAFE_API_URL = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_JEV_MODEL = "jev-1.14.0";

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
  operationalEnabled: true,
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
  /** Off: no Operational bucket; chat and tiny tasks start on `defaultPick`. */
  operationalEnabled: z.boolean().default(DEFAULT_JEV_EFFORT_FOCUSED.operationalEnabled),
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

/** Efforts "Upgrade effort mid-session" may raise a session to. */
export const JEV_UPGRADE_EFFORTS = ["high", "xhigh", "max"] as const;
export type JevUpgradeTarget = (typeof JEV_UPGRADE_EFFORTS)[number];

export const DEFAULT_JEV_UPGRADE_EFFORT: { enabled: boolean; efforts: JevUpgradeTarget[] } = {
  enabled: false,
  efforts: ["high"],
};

export const JevUpgradeEffortSchema = z.object({
  /** On: before a follow-up to an idle Claude session, Jev may raise its effort (never lower it). */
  enabled: z.boolean().default(DEFAULT_JEV_UPGRADE_EFFORT.enabled),
  /** The targets a hard follow-up may raise the effort to (the model must support them). */
  efforts: z.array(z.enum(JEV_UPGRADE_EFFORTS)).min(1).default(DEFAULT_JEV_UPGRADE_EFFORT.efforts),
});
export type JevUpgradeEffort = z.infer<typeof JevUpgradeEffortSchema>;

/** Host settings document (Settings > Plugins > jev-router, and the composer icon's sheet). */
export const JevRouterSettingsSchema = z.object({
  /** On: a small first prompt starts on the cheaper pick. The composer icon flips it. */
  enabled: z.boolean().default(true),
  /** TypeSafe gateway key. Empty: route.py reads TYPESAFE_API_KEY or ~/.config/typesafe/env. */
  apiKey: z.string().default(""),
  /** TypeSafe System One endpoint, as TYPESAFE_API_URL. Empty: jev.py's default. */
  apiUrl: z.string().default(""),
  /** Jev model, as JEV_MODEL. Empty: the one route.py's thresholds were measured on. */
  jevModel: z.string().default(""),
  routerScript: z.string().trim().min(1).default(DEFAULT_JEV_ROUTER_SCRIPT),
  python: z.string().trim().min(1).default("python3"),
  /** Jev call timeout handed to route.py; the plugin kills the script 3 s after it. */
  timeoutSeconds: z.number().min(0.5).max(10).default(2),
  /** Append each decision to ~/.local/state/jev-router/decisions.jsonl (`route.py review`). */
  logDecisions: z.boolean().default(true),
  mode: z.enum(JEV_ROUTER_MODES).default("model"),
  modelFocused: JevModelFocusedSchema.default(DEFAULT_JEV_MODEL_FOCUSED),
  effortFocused: JevEffortFocusedSchema.default(DEFAULT_JEV_EFFORT_FOCUSED),
  /** Both modes: raise a session's effort when a follow-up is hard. */
  upgradeEffort: JevUpgradeEffortSchema.default(DEFAULT_JEV_UPGRADE_EFFORT),
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

/** Tokens Jev used for one call (route.py `usage`). */
export const JevUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
});
export type JevUsage = z.infer<typeof JevUsageSchema>;

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
  /** Tokens this call used; null/absent when route.py did not report them. */
  usage: JevUsageSchema.nullable().optional(),
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

export const JevUpgradeInputSchema = z.object({
  agentId: z.string(),
  prompt: z.string(),
  cwd: z.string(),
  images: z.number().int().min(0).default(0),
  provider: z.string(),
  model: z.string().nullable(),
  /** The agent's current effort. */
  thinkingOptionId: z.string().nullable(),
  /** Efforts the agent's model supports. */
  availableEfforts: z.array(z.string()),
});
export type JevUpgradeInput = z.input<typeof JevUpgradeInputSchema>;

export const JevUpgradeOutputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("skipped"), reason: z.string() }),
  z.object({
    status: z.literal("checked"),
    decision: JevDecisionSchema,
    upgraded: z.boolean(),
    from: z.string(),
    to: z.string().nullable(),
  }),
]);
export type JevUpgradeOutput = z.infer<typeof JevUpgradeOutputSchema>;

/** Labels the app puts on the created agent, so its composer icon can tell what happened. */
export const JEV_LABELS = {
  pick: "custom.jev.pick",
  home: "custom.jev.home",
  why: "custom.jev.why",
  applied: "custom.jev.applied",
  /** Set when applied: the plugin's `agent.created` hook finds the stashed prompt by it. */
  routeId: "custom.jev.route-id",
  /** Jev's own consumption in this session: calls and tokens (see `addJevUsage` in the app). */
  calls: "custom.jev.calls",
  inputTokens: "custom.jev.input-tokens",
  outputTokens: "custom.jev.output-tokens",
} as const;

/**
 * Estimated USD per million Jev tokens. An estimate: the TypeSafe gateway gives no price, only
 * tokens (gnome-custom jev-router README: about US$ 0.00005 per call of ~1k tokens).
 */
export const JEV_USD_PER_MILLION_TOKENS = 0.05;

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

/** The card the plugin appends when Jev raised a session's effort mid-session. */
export const JEV_UPGRADE_TIMELINE_KIND = "jev-upgrade";
export const JEV_UPGRADE_TIMELINE_VERSION = 1;

export const JevUpgradeCardDataSchema = z.object({
  modelId: z.string(),
  fromEffort: z.string(),
  toEffort: z.string(),
  why: z.string(),
  jevEffort: z.string().nullable(),
});
export type JevUpgradeCardData = z.infer<typeof JevUpgradeCardDataSchema>;

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
 * nearest allowed one), hard to `hardPick`, everything else to `defaultPick`. With Operational
 * off, chat and operational go to `defaultPick` too.
 */
export function effortFocusedPick(
  config: JevEffortFocused,
  why: string,
  jevEffort: string | null | undefined,
): JevRouterPick {
  if (!config.operationalEnabled && (why === "chat" || why === "operational"))
    return config.defaultPick;
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
  if (config.operationalEnabled) add(config.operationalModel, config.operationalEfforts);
  add(config.defaultPick.model, [config.defaultPick.effort]);
  add(config.hardPick.model, [config.hardPick.effort]);
  return [...byModel].map(([model, efforts]) => ({
    model,
    efforts: [...efforts].sort((a, b) => effortRank(a) - effortRank(b)),
  }));
}

/** Full effort order for "Upgrade effort mid-session" (unlike `effortRank`, it knows xhigh and max). */
const UPGRADE_EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

function upgradeRank(effort: string | null | undefined): number {
  return effort
    ? UPGRADE_EFFORT_ORDER.indexOf(effort as (typeof UPGRADE_EFFORT_ORDER)[number])
    : -1;
}

/** The selected upgrade targets the model supports, in level order. */
export function upgradeCandidates(
  setting: Pick<JevUpgradeEffort, "efforts">,
  availableEfforts: readonly string[],
): string[] {
  return UPGRADE_EFFORT_ORDER.filter(
    (effort) =>
      (setting.efforts as readonly string[]).includes(effort) && availableEfforts.includes(effort),
  );
}

/** Worth asking Jev: the setting is on and the session sits below the highest candidate. */
export function needsUpgradeCheck(input: {
  setting: Pick<JevUpgradeEffort, "enabled" | "efforts">;
  currentEffort: string | null | undefined;
  availableEfforts: readonly string[];
}): boolean {
  if (!input.setting.enabled) return false;
  const candidates = upgradeCandidates(input.setting, input.availableEfforts);
  const highest = candidates[candidates.length - 1];
  if (!highest) return false;
  return upgradeRank(input.currentEffort) < upgradeRank(highest);
}

/**
 * The effort to raise to, or null. Wanted level: a `hard` bucket wants at least high (or Jev's own
 * pick when above); otherwise only Jev's own xhigh or max counts. The target is the smallest
 * candidate at or above it, else the highest candidate; it must be above the current effort.
 */
export function planEffortUpgrade(input: {
  currentEffort: string | null | undefined;
  candidates: readonly string[];
  why: string;
  jevEffort: string | null | undefined;
}): string | null {
  const jevRank = upgradeRank(input.jevEffort);
  const highRank = upgradeRank("high");
  let wanted = -1;
  if (input.why === "hard") wanted = Math.max(jevRank, highRank);
  else if (jevRank >= upgradeRank("xhigh")) wanted = jevRank;
  if (wanted < 0) return null;
  const sorted = [...input.candidates].sort((a, b) => upgradeRank(a) - upgradeRank(b));
  const target =
    sorted.find((effort) => upgradeRank(effort) >= wanted) ?? sorted[sorted.length - 1];
  if (!target) return null;
  return upgradeRank(target) > upgradeRank(input.currentEffort) ? target : null;
}

function readCount(value: string | undefined): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

/** What Jev has cost in a session so far, read from its labels. */
export function readJevUsage(labels: Record<string, string> | undefined): {
  calls: number;
  inputTokens: number;
  outputTokens: number;
} {
  return {
    calls: readCount(labels?.[JEV_LABELS.calls]),
    inputTokens: readCount(labels?.[JEV_LABELS.inputTokens]),
    outputTokens: readCount(labels?.[JEV_LABELS.outputTokens]),
  };
}

/** The three usage labels after one more Jev call that used `usage` (unknown tokens count as 0). */
export function addJevUsage(
  labels: Record<string, string> | undefined,
  usage: JevUsage | null | undefined,
): Record<string, string> {
  const current = readJevUsage(labels);
  return {
    [JEV_LABELS.calls]: String(current.calls + 1),
    [JEV_LABELS.inputTokens]: String(current.inputTokens + Math.max(0, usage?.inputTokens ?? 0)),
    [JEV_LABELS.outputTokens]: String(current.outputTokens + Math.max(0, usage?.outputTokens ?? 0)),
  };
}

/** Estimated USD for `tokens` Jev tokens (see `JEV_USD_PER_MILLION_TOKENS`). */
export function estimateJevUsd(tokens: number): number {
  return (tokens / 1_000_000) * JEV_USD_PER_MILLION_TOKENS;
}
