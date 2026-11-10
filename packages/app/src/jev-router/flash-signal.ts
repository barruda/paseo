// CUSTOM(jev-router): when Jev moves a new tab to its Default pick, the chips that changed flash
// green. The request waits here, by draft key, until the chip shows it: the chips may mount after
// the change landed, and a chip's first value never flashes on its own (ChangeFlash).

import { useCallback } from "react";
import { create } from "zustand";

export type JevChipPart = "model" | "effort";

let nextSignal = 1;

export const useJevFlashSignalStore = create<{
  byDraft: Record<string, Partial<Record<JevChipPart, number>>>;
  request(draftKey: string, parts: Partial<Record<JevChipPart, boolean>>): void;
  consume(draftKey: string, part: JevChipPart): void;
}>((set) => ({
  byDraft: {},
  request: (draftKey, parts) =>
    set((state) => {
      const next = { ...state.byDraft[draftKey] };
      if (parts.model) next.model = nextSignal++;
      if (parts.effort) next.effort = nextSignal++;
      return { byDraft: { ...state.byDraft, [draftKey]: next } };
    }),
  consume: (draftKey, part) =>
    set((state) => {
      const current = state.byDraft[draftKey];
      if (!current?.[part]) return state;
      const { [part]: _shown, ...rest } = current;
      return { byDraft: { ...state.byDraft, [draftKey]: rest } };
    }),
}));

/** The pending green flash of one chip of a draft, and the call that marks it shown. */
export function useJevChipSignal(
  draftKey: string | undefined,
  part: JevChipPart,
): { signal: number | undefined; consume: () => void } {
  const signal = useJevFlashSignalStore((state) =>
    draftKey ? state.byDraft[draftKey]?.[part] : undefined,
  );
  const consume = useCallback(() => {
    if (draftKey) useJevFlashSignalStore.getState().consume(draftKey, part);
  }, [draftKey, part]);
  return { signal, consume };
}
