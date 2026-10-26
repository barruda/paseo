// CUSTOM(content-width-boost): per-window multiplier on the chat content width, driven by the
// -, + and maximize buttons in the agent panel. Only applies while the desktop window is
// maximized; the configured width (Settings > Appearance) is the 1x step. The step is saved, so it
// holds for every agent and across restarts.
import { useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export const CONTENT_WIDTH_BOOST_STEPS = [1, 1.5, 2, "full"] as const;
export type ContentWidthBoost = (typeof CONTENT_WIDTH_BOOST_STEPS)[number];

/** Large enough to act as "no max width": the content fills the pane. */
const FULL_WIDTH = 100_000;

interface ContentWidthBoostState {
  stepIndex: number;
  windowMaximized: boolean;
  /** Width last patched into the theme by the appearance provider. */
  appliedWidth: number | null;
  setAppliedWidth(width: number): void;
  grow(): void;
  shrink(): void;
  toggleFull(): void;
  setWindowMaximized(maximized: boolean): void;
}

const lastIndex = CONTENT_WIDTH_BOOST_STEPS.length - 1;

export const useContentWidthBoostStore = create<ContentWidthBoostState>()(
  persist(
    (set) => ({
      stepIndex: 0,
      windowMaximized: false,
      appliedWidth: null,
      setAppliedWidth: (appliedWidth) => set({ appliedWidth }),
      grow: () => set((s) => ({ stepIndex: Math.min(lastIndex, s.stepIndex + 1) })),
      shrink: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
      toggleFull: () => set((s) => ({ stepIndex: s.stepIndex === lastIndex ? 0 : lastIndex })),
      setWindowMaximized: (windowMaximized) => set({ windowMaximized }),
    }),
    {
      name: "custom-content-width-boost",
      version: 1,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ stepIndex: z.number().int().min(0).max(lastIndex) }),
      ),
      partialize: (state) => ({ stepIndex: state.stepIndex }),
    },
  ),
);

export function boostContentMaxWidth(
  baseWidth: number,
  state: { stepIndex: number; windowMaximized: boolean },
): number {
  if (!state.windowMaximized) return baseWidth;
  const step = CONTENT_WIDTH_BOOST_STEPS[state.stepIndex] ?? 1;
  return step === "full" ? FULL_WIDTH : Math.round(baseWidth * step);
}

/**
 * Unistyles patches `theme.contentMaxWidth`, but a memoized stylesheet entry can keep handing a
 * re-rendered component the old value (the chat rows did). Components that must follow the
 * buttons at once add this style after their stylesheet entry. The appearance provider publishes
 * the width after patching the theme.
 */
export function useContentMaxWidthStyle(): { maxWidth: number } | null {
  const appliedWidth = useContentWidthBoostStore((s) => s.appliedWidth);
  return useMemo(() => (appliedWidth === null ? null : { maxWidth: appliedWidth }), [appliedWidth]);
}

/** Re-render a component whose stylesheet reads `theme.contentMaxWidth` when the width changes. */
export function useContentWidthBoostRerender(): void {
  useContentWidthBoostStore((s) => s.appliedWidth);
}

export function useAppliedContentMaxWidth(fallback: number): number {
  return useContentWidthBoostStore((s) => s.appliedWidth) ?? fallback;
}
