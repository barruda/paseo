// CUSTOM(commit-selection): when Ctrl+E opens the Explorer sidebar, the commit box focuses its
// message as soon as it mounts. A request left unclaimed (the Files tab was showing) expires, so
// a later switch to Changes doesn't steal focus.
import { create } from "zustand";

const REQUEST_TTL_MS = 2000;

interface CommitMessageFocusState {
  requestedAt: number | null;
  request: () => void;
  /** True once per fresh request; clears it. */
  claim: () => boolean;
}

export const useCommitMessageFocusStore = create<CommitMessageFocusState>()((set, get) => ({
  requestedAt: null,
  request: () => set({ requestedAt: Date.now() }),
  claim: () => {
    const { requestedAt } = get();
    if (requestedAt === null) return false;
    set({ requestedAt: null });
    return Date.now() - requestedAt <= REQUEST_TTL_MS;
  },
}));
