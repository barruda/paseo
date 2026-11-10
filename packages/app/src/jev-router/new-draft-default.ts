// CUSTOM(jev-router): with the router on in Effort focused, a new agent tab starts on the Default
// pick (Opus low by default) instead of the model and effort the last session left behind. Model
// and effort change in one render, and the composer chips flash on their own (ChangeFlash) when the
// value they show changes: the effort alone, the model alone, or both.

import { useEffect } from "react";
import type { JevRouterSettings } from "@getpaseo/protocol/jev-router";
import { useJevRouterSettingsStore } from "./cycle";
import { useJevFlashSignalStore } from "./flash-signal";
import { readLastViewedClaudeSelection } from "./last-viewed-agent";

export interface DraftModelOption {
  id: string;
  thinkingOptions?: readonly { id: string }[] | null;
}

export type NewDraftDefaultStep =
  | { kind: "wait" }
  | { kind: "done" }
  | {
      kind: "move";
      /** False when the draft already starts on Default (from the saved preferences). */
      apply: boolean;
      model: string;
      effort: string;
      flashModel: boolean;
      flashEffort: boolean;
    };

/**
 * What a draft whose selection has loaded should switch to, and which chips flash: the ones whose
 * Default differs from `source` (the session you came from), or from the draft's own starting
 * selection when there is no such session.
 */
export function planNewDraftDefault(input: {
  settings: JevRouterSettings | undefined;
  provider: string | null;
  modelId: string;
  effort: string;
  isLoading: boolean;
  availableModels: readonly DraftModelOption[];
  source: { model: string; effort: string | null } | null;
}): NewDraftDefaultStep {
  if (input.isLoading || !input.settings) return { kind: "wait" };
  // Loaded with nothing selected: the user's first pick is theirs, not Jev's to replace.
  if (!input.provider || !input.modelId) return { kind: "done" };
  const { settings } = input;
  if (!settings.enabled || settings.mode !== "effort" || input.provider !== "claude") {
    return { kind: "done" };
  }
  const pick = settings.effortFocused.defaultPick;
  const apply = input.modelId !== pick.model || input.effort !== pick.effort;
  // A model or effort the host doesn't offer: leave the selection alone.
  const model = input.availableModels.find((option) => option.id === pick.model);
  if (apply && !model?.thinkingOptions?.some((option) => option.id === pick.effort)) {
    return { kind: "done" };
  }
  const from = input.source ?? { model: input.modelId, effort: input.effort };
  const flashModel = from.model !== pick.model;
  const flashEffort = from.effort !== pick.effort;
  if (!apply && !flashModel && !flashEffort) return { kind: "done" };
  return { kind: "move", apply, model: pick.model, effort: pick.effort, flashModel, flashEffort };
}

/** Drafts already moved (or left alone): a remounted tab keeps what the user picked since. */
const settledDrafts = new Set<string>();

export function useJevDefaultPickForNewDraft(input: {
  serverId: string;
  draftId: string;
  /** The key the draft's composer chips read their green flash by (`DraftAgentControls.draftKey`). */
  flashKey: string;
  /** False for tabs that carry their own selection (fork, /clear, resolve conflicts). */
  isFreshDraft: boolean;
  provider: string | null;
  modelId: string;
  effort: string;
  isLoading: boolean;
  availableModels: readonly DraftModelOption[];
  apply: ((modelId: string, effort: string) => void) | undefined;
}): void {
  const settings = useJevRouterSettingsStore((state) => state.byServer[input.serverId]);
  const {
    serverId,
    draftId,
    flashKey,
    isFreshDraft,
    provider,
    modelId,
    effort,
    isLoading,
    availableModels,
    apply,
  } = input;

  useEffect(() => {
    if (settledDrafts.has(draftId)) return;
    if (!isFreshDraft || !apply) {
      settledDrafts.add(draftId);
      return;
    }
    const step = planNewDraftDefault({
      settings,
      provider,
      modelId,
      effort,
      isLoading,
      availableModels,
      source: readLastViewedClaudeSelection(serverId),
    });
    if (step.kind === "wait") return;
    settledDrafts.add(draftId);
    if (step.kind !== "move") return;
    useJevFlashSignalStore
      .getState()
      .request(flashKey, { model: step.flashModel, effort: step.flashEffort });
    if (step.apply) apply(step.model, step.effort);
  }, [
    apply,
    availableModels,
    draftId,
    effort,
    flashKey,
    isFreshDraft,
    isLoading,
    modelId,
    provider,
    serverId,
    settings,
  ]);
}
