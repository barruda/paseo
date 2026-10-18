// CUSTOM(commit-selection): checked files per checkout. In memory only, so every app start
// begins with nothing selected.
import { create } from "zustand";

interface CommitSelectionStore {
  byCheckout: Record<string, readonly string[]>;
  setSelection: (checkoutKey: string, paths: readonly string[]) => void;
}

const EMPTY: readonly string[] = [];

export const useCommitSelectionStore = create<CommitSelectionStore>()((set) => ({
  byCheckout: {},
  setSelection: (checkoutKey, paths) =>
    set((state) => ({ byCheckout: { ...state.byCheckout, [checkoutKey]: paths } })),
}));

export function selectCheckoutSelection(
  state: CommitSelectionStore,
  checkoutKey: string,
): readonly string[] {
  return state.byCheckout[checkoutKey] ?? EMPTY;
}
