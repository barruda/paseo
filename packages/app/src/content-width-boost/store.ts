// CUSTOM(content-width-boost): per-window multiplier on the chat content width, driven by the
// -, + and maximize buttons in the agent panel. Only applies while the desktop window is
// maximized; the configured width (Settings > Appearance) is the 1x step.
import { create } from "zustand";

export const CONTENT_WIDTH_BOOST_STEPS = [1, 1.5, 2, "full"] as const;
export type ContentWidthBoost = (typeof CONTENT_WIDTH_BOOST_STEPS)[number];

/** Large enough to act as "no max width": the content fills the pane. */
const FULL_WIDTH = 100_000;

interface ContentWidthBoostState {
  stepIndex: number;
  windowMaximized: boolean;
  grow(): void;
  shrink(): void;
  toggleFull(): void;
  setWindowMaximized(maximized: boolean): void;
}

const lastIndex = CONTENT_WIDTH_BOOST_STEPS.length - 1;

export const useContentWidthBoostStore = create<ContentWidthBoostState>()((set) => ({
  stepIndex: 0,
  windowMaximized: false,
  grow: () => set((s) => ({ stepIndex: Math.min(lastIndex, s.stepIndex + 1) })),
  shrink: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  toggleFull: () => set((s) => ({ stepIndex: s.stepIndex === lastIndex ? 0 : lastIndex })),
  setWindowMaximized: (windowMaximized) => set({ windowMaximized }),
}));

export function boostContentMaxWidth(
  baseWidth: number,
  state: { stepIndex: number; windowMaximized: boolean },
): number {
  if (!state.windowMaximized) return baseWidth;
  const step = CONTENT_WIDTH_BOOST_STEPS[state.stepIndex] ?? 1;
  return step === "full" ? FULL_WIDTH : Math.round(baseWidth * step);
}
