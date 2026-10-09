import type { AgentSelectOption } from "@getpaseo/protocol/agent-types";
import {
  filterAndRankModelRows,
  getAllProviderModelRows,
  type ProviderSelectionModelRow,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";

export interface ModelPickerSelection {
  providers: readonly ProviderSelectorProvider[];
  selectedProvider: string | null;
  selectedModelId: string | null;
  /** Effort levels of the selected model, as the composer resolved them. */
  thinkingOptions: readonly AgentSelectOption[];
  selectedThinkingId: string | null;
}

export interface ModelPickerModel {
  /** `provider:modelId`, the model's identity (and its favorite key). */
  key: string;
  provider: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  current: boolean;
  favorite: boolean;
}

/**
 * A model can be listed more than once (under Current, Favorites, and its provider), so each model
 * row has its own `key`, and the highlight follows rows, not models.
 */
export interface ModelPickerModelRow {
  kind: "model";
  key: string;
  model: ModelPickerModel;
}
export type ModelPickerRow = { kind: "section"; key: string; label: string } | ModelPickerModelRow;

export function modelPickerModelKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

function isCurrent(row: ProviderSelectionModelRow, selection: ModelPickerSelection): boolean {
  return row.provider === selection.selectedProvider && row.modelId === selection.selectedModelId;
}

function toPickerModel(
  row: ProviderSelectionModelRow,
  selection: ModelPickerSelection,
  favorites: ReadonlySet<string>,
): ModelPickerModel {
  const key = modelPickerModelKey(row.provider, row.modelId);
  return {
    key,
    provider: row.provider,
    providerLabel: row.providerLabel,
    modelId: row.modelId,
    modelLabel: row.modelLabel,
    current: isCurrent(row, selection),
    favorite: favorites.has(key),
  };
}

function modelRow(prefix: string, model: ModelPickerModel): ModelPickerModelRow {
  return { kind: "model", key: `${prefix}${model.key}`, model };
}

/**
 * Without a query: the current model, then the favorites (in the order they were added), then
 * every model under its provider. With a query, every provider's models are ranked together in one
 * flat list, favorites first, so typing a model name finds it wherever it lives.
 */
export function buildModelPickerRows(
  selection: ModelPickerSelection,
  query: string,
  favoriteKeys: readonly string[] = [],
): { rows: ModelPickerRow[]; items: ModelPickerModelRow[] } {
  const favorites = new Set(favoriteKeys);
  const normalized = query.trim().toLowerCase();
  if (normalized) {
    const ranked = filterAndRankModelRows(
      getAllProviderModelRows([...selection.providers]),
      normalized,
    ).map((row) => toPickerModel(row, selection, favorites));
    const ordered = [
      ...ranked.filter((model) => model.favorite),
      ...ranked.filter((model) => !model.favorite),
    ];
    const items = ordered.map((model) => modelRow("", model));
    return { rows: items, items };
  }

  const byProvider: { id: string; label: string; models: ModelPickerModel[] }[] = [];
  for (const provider of selection.providers) {
    if (provider.modelSelection.kind !== "models") continue;
    const models = provider.modelSelection.rows.map((row) =>
      toPickerModel(row, selection, favorites),
    );
    if (models.length > 0) byProvider.push({ id: provider.id, label: provider.label, models });
  }
  const all = new Map(byProvider.flatMap((group) => group.models.map((m) => [m.key, m] as const)));

  const rows: ModelPickerRow[] = [];
  const current = [...all.values()].find((model) => model.current);
  if (current) {
    rows.push({ kind: "section", key: "section:current", label: "Current" });
    rows.push(modelRow("current:", current));
  }
  const favoriteModels = favoriteKeys.flatMap((key) => all.get(key) ?? []);
  if (favoriteModels.length > 0) {
    rows.push({ kind: "section", key: "section:favorites", label: "Favorites" });
    for (const model of favoriteModels) rows.push(modelRow("favorite:", model));
  }
  for (const group of byProvider) {
    rows.push({ kind: "section", key: `section:${group.id}`, label: group.label });
    for (const model of group.models) rows.push(modelRow("", model));
  }
  const items = rows.filter((row): row is ModelPickerModelRow => row.kind === "model");
  return { rows, items };
}

/** The highlight survives a re-rank when its row is still listed; otherwise the first row. */
export function resolveHighlightedKey(
  highlightedKey: string | null,
  items: readonly ModelPickerModelRow[],
  preferCurrent: boolean,
): string | null {
  if (highlightedKey && items.some((item) => item.key === highlightedKey)) {
    return highlightedKey;
  }
  if (preferCurrent) {
    const current = items.find((item) => item.model.current);
    if (current) return current.key;
  }
  return items[0]?.key ?? null;
}

export function moveHighlightedKey(
  highlightedKey: string | null,
  items: readonly ModelPickerModelRow[],
  direction: 1 | -1,
): string | null {
  if (items.length === 0) return null;
  const index = items.findIndex((item) => item.key === highlightedKey);
  if (index === -1) return items[direction === 1 ? 0 : items.length - 1].key;
  return items[(index + direction + items.length) % items.length].key;
}

/** Adds a model to the end of the favorites, or removes it. */
export function toggleFavoriteKey(favoriteKeys: readonly string[], key: string): string[] {
  return favoriteKeys.includes(key)
    ? favoriteKeys.filter((entry) => entry !== key)
    : [...favoriteKeys, key];
}

function findRow(
  selection: ModelPickerSelection,
  model: ModelPickerModel,
): ProviderSelectionModelRow | null {
  for (const provider of selection.providers) {
    if (provider.id !== model.provider || provider.modelSelection.kind !== "models") continue;
    return provider.modelSelection.rows.find((row) => row.modelId === model.modelId) ?? null;
  }
  return null;
}

export interface ModelPickerEffort {
  options: readonly AgentSelectOption[];
  /** The effort the model has now (current model) or would start with (any other model). */
  baselineId: string | null;
}

export function resolveModelEffort(
  selection: ModelPickerSelection,
  model: ModelPickerModel | null,
): ModelPickerEffort {
  if (!model) return { options: [], baselineId: null };
  if (model.current) {
    return {
      options: selection.thinkingOptions,
      baselineId: selection.selectedThinkingId ?? selection.thinkingOptions[0]?.id ?? null,
    };
  }
  const row = findRow(selection, model);
  const options = row?.thinkingOptions ?? [];
  const baselineId =
    row?.defaultThinkingOptionId ??
    options.find((option) => option.isDefault)?.id ??
    options[0]?.id ??
    null;
  return { options, baselineId };
}

/**
 * The effort the user picked with ←/→ carries across models that offer it, so choosing "High" and
 * then moving to another model keeps "High" when that model has it.
 */
export function resolveEffortId(effort: ModelPickerEffort, chosenId: string | null): string | null {
  if (chosenId && effort.options.some((option) => option.id === chosenId)) return chosenId;
  return effort.baselineId;
}

export function moveEffortId(
  effort: ModelPickerEffort,
  effortId: string | null,
  direction: 1 | -1,
): string | null {
  const { options } = effort;
  if (options.length === 0) return null;
  const index = options.findIndex((option) => option.id === effortId);
  if (index === -1) return options[0].id;
  return options[Math.min(options.length - 1, Math.max(0, index + direction))].id;
}

export type ModelPickerApplyPlan =
  | { kind: "none" }
  | { kind: "effort"; effortId: string }
  | { kind: "model"; provider: string; modelId: string; effortId: string | null };

/**
 * A new model's effort can only be set once the composer has switched to that model, so a model
 * change carries the effort to apply afterwards instead of setting both at once.
 */
export function planModelPickerApply(input: {
  selection: ModelPickerSelection;
  model: ModelPickerModel | null;
  effortId: string | null;
}): ModelPickerApplyPlan {
  const { model, effortId, selection } = input;
  if (!model) return { kind: "none" };
  if (!model.current) {
    return { kind: "model", provider: model.provider, modelId: model.modelId, effortId };
  }
  if (effortId && effortId !== selection.selectedThinkingId) {
    return { kind: "effort", effortId };
  }
  return { kind: "none" };
}
