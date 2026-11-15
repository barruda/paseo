// CUSTOM(jev-router): ←/→ in the composer with Effort focused's "Lock models/effort fast cycling",
// only while the router is on.
// The composer icon keeps each host's router settings here, so the key handlers can read them
// synchronously. The pure functions below pick the next model or effort inside the locked set.

import { create } from "zustand";
import {
  effortFocusedCycle,
  nearestEffort,
  type JevRouterSettings,
} from "@getpaseo/protocol/jev-router";
import { isWeb } from "@/constants/platform";

export const useJevRouterSettingsStore = create<{
  byServer: Record<string, JevRouterSettings>;
  set(serverId: string, settings: JevRouterSettings): void;
}>((set) => ({
  byServer: {},
  set: (serverId, settings) =>
    set((state) =>
      state.byServer[serverId] === settings
        ? state
        : { byServer: { ...state.byServer, [serverId]: settings } },
    ),
}));

export interface LockedCycle {
  model: string;
  efforts: string[];
}

/**
 * The models and efforts ←/→ may land on for a Claude composer on `serverId`, or null when the
 * lock is off (router off, not Effort focused, the option unchecked, another provider or no
 * router plugin). With the router off, ←/→ cycle only the model and effort favorites.
 */
export function lockedCycleFor(
  serverId: string | null | undefined,
  provider: string | null | undefined,
): LockedCycle[] | null {
  if (!serverId || provider !== "claude") return null;
  const settings = useJevRouterSettingsStore.getState().byServer[serverId];
  if (!settings?.enabled || settings.mode !== "effort" || !settings.effortFocused.lockCycling)
    return null;
  const cycle = effortFocusedCycle(settings.effortFocused);
  return cycle.length ? cycle : null;
}

/**
 * ← in the lock: the previous model of the cycle, wrapping (from a model outside it, the last
 * one). The effort stays when the new model allows it, else moves to the nearest allowed one.
 */
export function lockedPreviousModel(
  cycle: readonly LockedCycle[],
  modelId: string | null,
  effortId: string | null,
): { model: string; effort: string } | null {
  if (!cycle.length) return null;
  const index = cycle.findIndex((entry) => entry.model === modelId);
  const next =
    index < 0 ? cycle[cycle.length - 1] : cycle[(index - 1 + cycle.length) % cycle.length];
  if (next.model === modelId && cycle.length === 1) return null;
  const effort =
    effortId && next.efforts.includes(effortId) ? effortId : nearestEffort(next.efforts, effortId);
  return { model: next.model, effort };
}

/**
 * → in the lock: the next allowed effort of the current model, wrapping. The model's starred
 * efforts narrow the allowed ones when any of them is starred. A model outside the lock answers
 * null, so → falls back to the regular (favorites) effort cycling.
 */
export function lockedNextEffort(
  cycle: readonly LockedCycle[],
  modelId: string | null,
  effortId: string | null,
  favoriteIds: readonly string[] = [],
): string | null {
  const entry = cycle.find((item) => item.model === modelId);
  if (!entry || entry.efforts.length === 0) return null;
  const starred = entry.efforts.filter((effort) => favoriteIds.includes(effort));
  const efforts = starred.length ? starred : entry.efforts;
  const index = efforts.indexOf(effortId ?? "");
  return efforts[(index + 1) % efforts.length];
}

/**
 * → changes the effort while typing when the caret sits at the end of the text with nothing
 * selected: there is nothing to its right to move to.
 */
export function isFocusedComposerCaretAtEnd(): boolean {
  const textArea = focusedTextArea();
  return (
    textArea !== null &&
    textArea.selectionStart === textArea.selectionEnd &&
    textArea.selectionEnd === textArea.value.length
  );
}

/** The focused composer has no text (← only changes the model then). */
export function isFocusedComposerEmpty(): boolean {
  return focusedTextArea()?.value.length === 0;
}

function focusedTextArea(): HTMLTextAreaElement | null {
  if (!isWeb || typeof document === "undefined") return null;
  const element = document.activeElement;
  if (!element || element.tagName !== "TEXTAREA") return null;
  return element as HTMLTextAreaElement;
}

/**
 * ←/→ under the lock. Returns true when it moved the model or effort; false leaves the key to the
 * regular cycling (lock off, or → on a model outside the lock).
 */
export function handleLockedCycleKey(input: {
  actionId: string;
  serverId: string | null | undefined;
  provider: string | null | undefined;
  modelId: string | null;
  effortId: string | null;
  /** The current model's starred efforts (CUSTOM(effort-favorites)). */
  effortFavorites?: readonly string[];
  selectModelAndEffort: (model: string, effort: string) => void;
  selectEffort: (effort: string) => void;
}): boolean {
  const cycle = lockedCycleFor(input.serverId, input.provider);
  if (!cycle) return false;
  if (input.actionId === "task.draft.model") {
    const next = lockedPreviousModel(cycle, input.modelId, input.effortId);
    if (!next) return true;
    input.selectModelAndEffort(next.model, next.effort);
    return true;
  }
  if (input.actionId === "task.draft.effort") {
    const next = lockedNextEffort(cycle, input.modelId, input.effortId, input.effortFavorites);
    if (!next) return false;
    if (next !== input.effortId) input.selectEffort(next);
    return true;
  }
  return false;
}
