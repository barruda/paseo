// CUSTOM(jev-router): with the router on in Effort focused, a new agent tab starts on the Default
// pick (Opus low by default) instead of the model and effort the last session left behind. Model
// and effort change in one render, and the composer chips flash on their own (ChangeFlash) when the
// value they show changes: the effort alone, the model alone, or both.

import { useEffect } from "react";
import type { JevRouterSettings } from "@getpaseo/protocol/jev-router";
import { useJevRouterSettingsStore } from "./cycle";
import { useJevFlashSignalStore } from "./flash-signal";

export interface DraftModelOption {
  id: string;
  thinkingOptions?: readonly { id: string }[] | null;
}

export type NewDraftDefaultStep =
  | { kind: "wait" }
  | { kind: "done" }
  | { kind: "apply"; model: string; effort: string; modelChanged: boolean; effortChanged: boolean };

/** What a draft whose selection has loaded should switch to, if anything. */
export function planNewDraftDefault(input: {
  settings: JevRouterSettings | undefined;
  provider: string | null;
  modelId: string;
  effort: string;
  isLoading: boolean;
  availableModels: readonly DraftModelOption[];
}): NewDraftDefaultStep {
  if (input.isLoading || !input.provider || !input.modelId || !input.settings) {
    return { kind: "wait" };
  }
  const { settings } = input;
  if (!settings.enabled || settings.mode !== "effort" || input.provider !== "claude") {
    return { kind: "done" };
  }
  const pick = settings.effortFocused.defaultPick;
  if (input.modelId === pick.model && input.effort === pick.effort) return { kind: "done" };
  // A model or effort the host doesn't offer: leave the selection alone.
  const model = input.availableModels.find((option) => option.id === pick.model);
  if (!model?.thinkingOptions?.some((option) => option.id === pick.effort)) {
    return { kind: "done" };
  }
  return {
    kind: "apply",
    model: pick.model,
    effort: pick.effort,
    modelChanged: input.modelId !== pick.model,
    effortChanged: input.effort !== pick.effort,
  };
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
    });
    if (step.kind === "wait") return;
    settledDrafts.add(draftId);
    if (step.kind !== "apply") return;
    useJevFlashSignalStore
      .getState()
      .request(flashKey, { model: step.modelChanged, effort: step.effortChanged });
    apply(step.model, step.effort);
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
    settings,
  ]);
}
