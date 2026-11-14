// CUSTOM(delegation-paseo-runner): the options of the Paseo subagent's Provider, Model and
// Thinking selects, from the host's provider catalog (the same snapshot the agent form reads).
// A stored value the catalog does not list stays selectable, so opening the sheet never rewrites it.

import type { AgentModelDefinition, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { filterSelectableModels } from "@/provider-selection/model-catalog";

export interface PaseoSelectOption {
  value: string;
  label: string;
}

const DEFAULT_OPTION: PaseoSelectOption = { value: "", label: "Default" };

function withStored(options: PaseoSelectOption[], stored: string): PaseoSelectOption[] {
  if (!stored || options.some((option) => option.value === stored)) return options;
  return [...options, { value: stored, label: stored }];
}

function selectableModels(
  entries: readonly ProviderSnapshotEntry[],
  provider: string,
): AgentModelDefinition[] {
  const entry = entries.find((candidate) => candidate.provider === provider);
  return filterSelectableModels(entry?.models ?? null) ?? [];
}

export function paseoProviderOptions(
  entries: readonly ProviderSnapshotEntry[],
  stored: string,
): PaseoSelectOption[] {
  const options = entries
    .filter((entry) => entry.enabled)
    .map((entry) => ({ value: entry.provider, label: entry.label ?? entry.provider }));
  return withStored(options, stored);
}

export function paseoModelOptions(
  entries: readonly ProviderSnapshotEntry[],
  provider: string,
  stored: string,
): PaseoSelectOption[] {
  const models = selectableModels(entries, provider).map((model) => ({
    value: model.id,
    label: model.label,
  }));
  return withStored([DEFAULT_OPTION, ...models], stored);
}

/** The model the provider launches when none is named: the flagged default, else the first. */
function effectiveModel(
  models: readonly AgentModelDefinition[],
  modelId: string,
): AgentModelDefinition | null {
  if (modelId) return models.find((model) => model.id === modelId) ?? null;
  return models.find((model) => model.isDefault) ?? models[0] ?? null;
}

function thinkingChoices(
  entries: readonly ProviderSnapshotEntry[],
  provider: string,
  modelId: string,
): PaseoSelectOption[] {
  const model = effectiveModel(selectableModels(entries, provider), modelId);
  return (model?.thinkingOptions ?? []).map((option) => ({
    value: option.id,
    label: option.label,
  }));
}

export function paseoThinkingOptions(
  entries: readonly ProviderSnapshotEntry[],
  provider: string,
  modelId: string,
  stored: string,
): PaseoSelectOption[] {
  return withStored([DEFAULT_OPTION, ...thinkingChoices(entries, provider, modelId)], stored);
}

/** What a model offers, for the form model to decide whether the stored thinking option stays. */
export function offeredThinkingIds(
  entries: readonly ProviderSnapshotEntry[],
  provider: string,
  modelId: string,
): string[] {
  return thinkingChoices(entries, provider, modelId).map((option) => option.value);
}
