import {
  JEV_LABELS,
  type JevDecision,
  type JevRouteOutput,
  type JevRouterSettings,
} from "@getpaseo/protocol/jev-router";

// Pure pieces of the router: which sessions qualify, how route.py is called, how its answer turns
// into a model/effort and labels. Only a strictly cheaper model family is ever applied.

const FAMILY_RANK: Record<string, number> = { haiku: 1, sonnet: 2, opus: 3, fable: 4, mythos: 5 };

/** Model family of a Claude model id (`claude-opus-4-8[1m]` → opus), or null when unknown. */
export function familyOf(modelId: string | null): string | null {
  if (!modelId) return null;
  const id = modelId.toLowerCase();
  return Object.keys(FAMILY_RANK).find((family) => id.includes(family)) ?? null;
}

export interface RouteHome {
  family: string;
  effort: string;
}

/** The session's selection without routing, or why it can't be routed. */
export function resolveHome(input: {
  provider: string;
  model: string | null;
  thinkingOptionId: string | null;
}): RouteHome | { skip: string } {
  if (input.provider !== "claude") return { skip: `provider ${input.provider}` };
  const family = familyOf(input.model);
  if (!family) return { skip: input.model ? `unknown model ${input.model}` : "no model selected" };
  if (family === "haiku") return { skip: "already on Haiku" };
  return { family, effort: input.thinkingOptionId || "high" };
}

export function expandHome(file: string, home: string): string {
  if (file === "~") return home;
  return file.startsWith("~/") ? `${home}/${file.slice(2)}` : file;
}

export function buildRouterArgs(input: {
  settings: Pick<JevRouterSettings, "routerScript" | "timeoutSeconds" | "logDecisions">;
  home: RouteHome;
  cwd: string;
  images: number;
  test: boolean;
  homeDir: string;
}): string[] {
  const args = [
    expandHome(input.settings.routerScript, input.homeDir),
    "--cwd",
    input.cwd,
    "--images",
    String(input.images),
    "--home",
    `${input.home.family}/${input.home.effort}`,
    "--timeout",
    String(input.settings.timeoutSeconds),
  ];
  if (input.test || !input.settings.logDecisions) args.push("--no-log");
  return args;
}

/** Reads route.py's stdout: one JSON object on the last non-empty line. */
export function parseRouterOutput(stdout: string): JevDecision {
  const line = stdout.trim().split("\n").pop() ?? "";
  const raw = JSON.parse(line) as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : null);
  const model = text("model");
  const modelId = text("model_id");
  const effort = text("effort");
  if (!model || !modelId || !effort) throw new Error(`route.py answered without a model: ${line}`);
  return {
    model,
    modelId,
    effort,
    why: text("why") ?? "home",
    latencyMs: typeof raw.latency_ms === "number" ? raw.latency_ms : null,
    error: text("error"),
  };
}

export function planRoute(input: {
  decision: JevDecision;
  home: RouteHome;
  apply: boolean;
}): Extract<JevRouteOutput, { status: "routed" }> {
  const { decision, home } = input;
  const cheaper =
    !decision.error && (FAMILY_RANK[decision.model] ?? 99) < (FAMILY_RANK[home.family] ?? 0);
  const applied = cheaper && input.apply;
  const homeLabel = `${home.family}/${home.effort}`;
  return {
    status: "routed",
    decision,
    home: homeLabel,
    model: cheaper ? decision.modelId : null,
    thinkingOptionId: cheaper ? decision.effort : null,
    applied,
    labels: {
      [JEV_LABELS.pick]: cheaper ? `${decision.model}/${decision.effort}` : homeLabel,
      [JEV_LABELS.home]: homeLabel,
      [JEV_LABELS.why]: decision.error ? "error" : decision.why,
      [JEV_LABELS.applied]: applied ? "true" : "false",
    },
  };
}
