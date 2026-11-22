// CUSTOM(factory): the factory setting and what shadow and active mode report (docs/factory.md).
// The board and the Orchestrators tab read the summary from the snapshot; the full status comes
// from `workboard.factory.status`.
import { z } from "zod";

export const FACTORY_MODES = ["off", "shadow", "active"] as const;
export const factoryModeSchema = z.enum(FACTORY_MODES);
export type FactoryMode = z.infer<typeof factoryModeSchema>;

/** Kept in `assistant.settings.factory`; edited in Settings > Bruno's Customizations > Project Manager. */
export const factorySettingsSchema = z.object({
  /** The factory folder; empty is `$PASEO_HOME/factory`. `~/` is the user's home. */
  root: z.string().trim().max(4096).default(""),
  mode: factoryModeSchema.default("off"),
});
export type FactorySettings = z.infer<typeof factorySettingsSchema>;

export const factoryIssueSchema = z.object({
  kind: z.string(),
  file: z.string(),
  line: z.number().nullable(),
  message: z.string(),
});

/** One field where the compiled factory and the live config disagree. */
export const factoryDifferenceSchema = z.object({
  /** `workers.paseo.maxConcurrent`, `board.columns.order`, `pm.systemPrompt`... */
  path: z.string(),
  /** The value as JSON text, shortened; null when the side does not have it. */
  live: z.string().nullable(),
  factory: z.string().nullable(),
});
export type FactoryDifference = z.infer<typeof factoryDifferenceSchema>;

/** At most this many differences travel in the status; `differenceCount` has them all. */
export const FACTORY_DIFFERENCE_LIMIT = 200;

export const factoryStatusSchema = z.object({
  mode: factoryModeSchema,
  /** The folder watched, resolved; "" while the mode is off. */
  root: z.string(),
  /** A load is waiting for the debounce or running. */
  loading: z.boolean(),
  loadedAt: z.string().nullable(),
  /** git `HEAD`, plus `+dirty.<hash>` with uncommitted changes; null outside a git repository. */
  revision: z.string().nullable(),
  /** Problems of the last load. The diff keeps using the last valid factory. */
  errors: z.array(factoryIssueSchema),
  warnings: z.array(factoryIssueSchema),
  /** A factory compiled since the folder was set; false until one does. */
  compiled: z.boolean(),
  differences: z.array(factoryDifferenceSchema),
  differenceCount: z.number().int(),
  /** Why the mode runs differently than its name says (`active` with nothing compiled yet). */
  note: z.string().nullable(),
});
export type FactoryStatus = z.infer<typeof factoryStatusSchema>;

/** The banner's share of the status, carried by every board snapshot. */
export const factorySummarySchema = z.object({
  mode: factoryModeSchema,
  loading: z.boolean(),
  errors: z.number().int(),
  /** `file:line: message` of the first error. */
  firstError: z.string().nullable(),
  /** null until a factory compiles. */
  differences: z.number().int().nullable(),
  note: z.string().nullable(),
  /** The loaded revision; active mode shows it. Optional: older plugin builds do not send it. */
  revision: z.string().nullable().optional(),
});
export type FactorySummary = z.infer<typeof factorySummarySchema>;

export const formatFactoryIssue = (issue: {
  file: string;
  line: number | null;
  message: string;
}) =>
  `${issue.file}${issue.line === null ? "" : `:${issue.line}`}: ${issue.message}`;
