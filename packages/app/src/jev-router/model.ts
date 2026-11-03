// CUSTOM(jev-router): pure pieces of the composer icon and the draft submit hook.

import {
  JEV_LABELS,
  JevRouteOutputSchema,
  type JevRouterSettings,
} from "@getpaseo/protocol/jev-router";

export interface JevSessionLabels {
  pick: string;
  home: string;
  why: string;
  applied: boolean;
}

export function readJevLabels(labels: Record<string, string> | undefined): JevSessionLabels | null {
  const pick = labels?.[JEV_LABELS.pick];
  const home = labels?.[JEV_LABELS.home];
  if (!pick || !home) return null;
  return {
    pick,
    home,
    why: labels?.[JEV_LABELS.why] ?? "home",
    applied: labels?.[JEV_LABELS.applied] === "true",
  };
}

/** Tooltip lines: on or off, what a click does, and what happened to this session. */
export function describeJevRouter(input: {
  settings: Pick<JevRouterSettings, "enabled">;
  session: JevSessionLabels | null;
}): string[] {
  const lines = input.settings.enabled
    ? ["Jev router: on", "Small first prompts start on Sonnet or Haiku. Click to turn it off."]
    : ["Jev router: off", "New sessions start on the model you pick. Click to turn it on."];
  const session = input.session;
  if (!session) return lines;
  if (session.why === "error") lines.push(`This session: router failed, kept ${session.home}`);
  else if (session.applied)
    lines.push(`This session: started on ${session.pick} (${session.why}), not ${session.home}`);
  else lines.push(`This session: kept ${session.home}`);
  return lines;
}

export interface DraftRouteConfig {
  provider: string;
  model?: string;
  thinkingOptionId?: string;
}

/**
 * Turns the plugin's answer into the create request's config and labels. Anything unexpected
 * keeps the config as selected: routing must never block or change a session by mistake.
 */
export function applyJevRoute<Config extends DraftRouteConfig>(
  config: Config,
  output: unknown,
): { config: Config; labels: Record<string, string> } {
  const parsed = JevRouteOutputSchema.safeParse(output);
  if (!parsed.success || parsed.data.status !== "routed") return { config, labels: {} };
  const route = parsed.data;
  if (!route.applied || !route.model || !route.thinkingOptionId)
    return { config, labels: route.labels };
  return {
    config: { ...config, model: route.model, thinkingOptionId: route.thinkingOptionId },
    labels: route.labels,
  };
}
