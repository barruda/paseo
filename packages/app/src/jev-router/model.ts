// CUSTOM(jev-router): pure pieces of the composer icon and the draft submit hook.

import {
  JEV_LABELS,
  JEV_TIMELINE_KIND,
  JevRouteCardDataSchema,
  JevRouteOutputSchema,
  formatClaudeModel,
  type JevRouteCardData,
  type JevRouterSettings,
} from "@getpaseo/protocol/jev-router";
import type { StreamItem } from "@/types/stream";

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

/** Tooltip lines: on or off and the mode, what a click does, and what happened to this session. */
export function describeJevRouter(input: {
  settings: Pick<JevRouterSettings, "enabled" | "mode">;
  session: JevSessionLabels | null;
}): string[] {
  const mode = input.settings.mode === "effort" ? "Effort focused" : "Model focused";
  const lines = input.settings.enabled
    ? [
        `Jev router: on · ${mode}`,
        input.settings.mode === "effort"
          ? "New sessions start on Haiku, Opus low or Opus high, by their first prompt."
          : "Small first prompts start on a cheaper model.",
      ]
    : [`Jev router: off · ${mode}`, "New sessions start on the model you pick."];
  lines.push("Click for the router settings.");
  const session = input.session;
  if (!session) return lines;
  if (session.why === "error") lines.push(`This session: router failed, kept ${session.home}`);
  else if (session.applied)
    lines.push(`This session: started on ${session.pick} (${session.why}), not ${session.home}`);
  else lines.push(`This session: kept ${session.home}`);
  return lines;
}

/**
 * A draft that carries a previous conversation (a fork or a /btw thread: a `chat_history`
 * attachment) continues that thread on the source agent's model. Routing it to another model
 * would throw away the prompt cache the thread already warmed, so it is never routed.
 */
export function isThreadDraft(attachments: unknown): boolean {
  if (!Array.isArray(attachments)) return false;
  return attachments.some(
    (attachment: unknown) =>
      typeof attachment === "object" &&
      attachment !== null &&
      (attachment as { contextKind?: unknown }).contextKind === "chat_history",
  );
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

/** The router card's raw data in the loaded timeline (the plugin appends it right after creation). */
export function findJevRouteCardData(items: readonly StreamItem[]): unknown {
  for (const item of items) {
    if (item.kind === "plugin" && item.itemKind === JEV_TIMELINE_KIND) return item.data;
  }
  return undefined;
}

export interface JevRouteChipModel {
  /** "Model: Haiku 5.5 Effort: low", or "Effort: high" when only the effort changed. */
  label: string;
  /** What the user had selected: "Opus 5.5 · high". */
  previous: string;
  previousModelId: string;
  previousEffort: string | null;
  /** Null when the first prompt was too long to keep: the chip has no restart then. */
  prompt: string | null;
}

/**
 * The composer chip for a session Jev started on another model or effort. It shows while the
 * agent is still on Jev's pick; once the user changes the model or effort it goes away.
 */
export function describeRouteChip(
  rawCard: unknown,
  current: { model: string | null | undefined; effort: string | null | undefined },
): JevRouteChipModel | null {
  const parsed = JevRouteCardDataSchema.safeParse(rawCard);
  if (!parsed.success) return null;
  const card: JevRouteCardData = parsed.data;
  if (current.model !== card.pickModelId || current.effort !== card.pickEffort) return null;
  const modelChanged = card.pickModelId !== card.homeModelId;
  const home = formatClaudeModel(card.homeModelId);
  return {
    label: modelChanged
      ? `Model: ${formatClaudeModel(card.pickModelId)} Effort: ${card.pickEffort}`
      : `Effort: ${card.pickEffort}`,
    previous: card.homeThinkingOptionId ? `${home} · ${card.homeThinkingOptionId}` : home,
    previousModelId: card.homeModelId,
    previousEffort: card.homeThinkingOptionId,
    prompt: card.prompt,
  };
}
