// CUSTOM(factory): the Project Manager's autonomy presets (docs/factory.md, ticket 12). What the PM
// decides alone and what goes to the user is data here, not loose prompt text: the wake, CHAT_RULES,
// the seed prompt and the tool descriptions are generated from it, and the tools refuse by it.
import { z } from "zod";

export const AUTONOMY_PRESET_IDS = [
  "autonomous",
  "standard",
  "cautious",
] as const;
export const autonomyPresetIdSchema = z.enum(AUTONOMY_PRESET_IDS);
export type AutonomyPresetId = z.infer<typeof autonomyPresetIdSchema>;

/** The preset of a project when no factory file sets one, and outside active mode. */
export const DEFAULT_AUTONOMY: AutonomyPresetId = "standard";

/**
 * Why a decision is the user's. `critical-merge` is the merge ok of a critical project (pipeline
 * `critical`); `merge` is any merge.
 */
export const USER_ONLY_REASONS = [
  "critical-merge",
  "merge",
  "data-migration",
  "product",
  "irreversible",
] as const;
export const userOnlyReasonSchema = z.enum(USER_ONLY_REASONS);
export type UserOnlyReason = z.infer<typeof userOnlyReasonSchema>;

// COMPAT(factory-pipelines): added in ticket 13 (2026-11-22), remove after 2027-02-20 once the factory cutover is done
// A stored card, or a live PM prompt that predates the rename, still says `fresh-agent`. This is
// plugin data, not the packages/protocol wire, so a transform is allowed.
export const storedUserOnlyReasonSchema = z.union([
  userOnlyReasonSchema,
  z.literal("fresh-agent").transform(() => "critical-merge" as const),
]);

/** What each reason covers, as the prompts say it. */
export const USER_ONLY_REASON_TEXT: Record<UserOnlyReason, string> = {
  "critical-merge":
    "the ok before merging a critical project (pipeline critical)",
  merge: "the ok before every merge",
  "data-migration": "every migration of live data, even with a backup",
  product:
    "product decisions (what to build, visible behavior the user did not specify)",
  irreversible:
    "actions with no backup and no revert (deleting data with no copy, publishing outside: PR, push, external message; restarting the daemon)",
};

/** What stays the PM's in every preset unless a reason above takes it. */
export const PM_DECIDES_TEXT =
  "merging after an approved review, a data migration with a backup made first, a plugin reload, a config change with a copy";

export type AutonomyPreset = {
  id: AutonomyPresetId;
  /** The UI label (pt-BR, as the board shows it). */
  label: string;
  /** The reasons a decision goes to the user under this preset; everything else is the PM's. */
  userDecides: readonly UserOnlyReason[];
  /**
   * Minutes after which a proposal waiting on the user with a recommendation and no
   * `userOnlyReason` wakes the PM to decide it (the breaker of #165); null: no breaker.
   */
  breakerMinutes: number | null;
};

export const AUTONOMY_PRESETS: Record<AutonomyPresetId, AutonomyPreset> = {
  autonomous: {
    id: "autonomous",
    label: "Autônomo",
    userDecides: ["product", "irreversible"],
    breakerMinutes: 15,
  },
  standard: {
    id: "standard",
    label: "Padrão",
    userDecides: ["critical-merge", "product", "irreversible"],
    breakerMinutes: 15,
  },
  cautious: {
    id: "cautious",
    label: "Cauteloso",
    userDecides: [
      "merge",
      "critical-merge",
      "data-migration",
      "product",
      "irreversible",
    ],
    breakerMinutes: null,
  },
};

export function autonomyPreset(id: AutonomyPresetId | null | undefined) {
  return AUTONOMY_PRESETS[id ?? DEFAULT_AUTONOMY];
}

/** The breaker's deadline in ms, or null when the preset has none. */
export function autonomyBreakerMs(id: AutonomyPresetId | null | undefined) {
  const minutes = autonomyPreset(id).breakerMinutes;
  return minutes === null ? null : minutes * 60_000;
}

/** Whether merging this project needs the user's ok. */
export function mergeNeedsUser(
  id: AutonomyPresetId | null | undefined,
  critical: boolean,
): boolean {
  const reasons = autonomyPreset(id).userDecides;
  return (
    reasons.includes("merge") ||
    (critical && reasons.includes("critical-merge"))
  );
}

/** The reasons that hold for this project: `critical-merge` only on a critical one. */
export function userOnlyReasonsFor(
  id: AutonomyPresetId | null | undefined,
  critical: boolean,
): UserOnlyReason[] {
  return autonomyPreset(id).userDecides.filter(
    (reason) => reason !== "critical-merge" || critical,
  );
}

/**
 * Null when `reason` lets a decision go to the user on this project; otherwise the refusal the
 * tools return. pm_card_create and board_pipeline_ask share it.
 */
export function userOnlyRefusal(
  id: AutonomyPresetId | null | undefined,
  critical: boolean,
  reason: UserOnlyReason,
): string | null {
  const allowed = userOnlyReasonsFor(id, critical);
  if (allowed.includes(reason)) return null;
  const preset = autonomyPreset(id);
  const why =
    reason === "critical-merge" && preset.userDecides.includes("critical-merge")
      ? "the project is not critical"
      : `the ${preset.label} (${preset.id}) preset leaves it to you`;
  return `This decision is yours, not the user's: ${USER_ONLY_REASON_TEXT[reason]} — ${why}. Decide it yourself (back up first when there is data), act, and record it as a kind decision card (decidedBy pm). Reasons the user owns on this project: ${allowed.join(", ") || "none"}.`;
}

/**
 * One project's rule, for a wake line: who merges and what else is the user's. A critical project
 * under Padrão says the merge is the user's; a default one says it is the PM's.
 */
export function autonomyProjectRule(
  id: AutonomyPresetId | null | undefined,
  critical: boolean,
): string {
  const preset = autonomyPreset(id);
  const merge = mergeNeedsUser(preset.id, critical)
    ? "the merge ok is the user's"
    : "the merge is yours after an approved review";
  const others = userOnlyReasonsFor(preset.id, critical)
    .filter((reason) => reason !== "critical-merge" && reason !== "merge")
    .map((reason) => USER_ONLY_REASON_TEXT[reason]);
  return `autonomy ${preset.label} (${preset.id}${critical ? ", critical" : ""}): ${merge}; the user also decides ${others.join("; ") || "nothing else"}`;
}

/**
 * The rule for every preset, for CHAT_RULES, the seed prompt and the tool descriptions, which
 * cannot know the project. Generated from AUTONOMY_PRESETS, never written by hand.
 */
export function autonomyRulesText(): string {
  const presets = AUTONOMY_PRESET_IDS.map((id) => {
    const preset = AUTONOMY_PRESETS[id];
    const reasons = preset.userDecides.map(
      (reason) => `${USER_ONLY_REASON_TEXT[reason]} [${reason}]`,
    );
    return `${preset.label} (${id}): ${reasons.join("; ")}`;
  });
  return `What goes to the user depends on the project's autonomy preset (each Needs you line and board_overview show it). The user decides only: ${presets.join(". ")}. Everything else is yours, and the merge of a project these reasons do not cover too: ${PM_DECIDES_TEXT}. Make the backup, act and report; never leave a card waiting on the user for a decision that is yours. When you do ask, name the reason (userOnlyReason) from the project's list: a reason the preset does not give the user is refused.`;
}
