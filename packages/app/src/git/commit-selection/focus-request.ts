// CUSTOM(commit-selection): asks the commit box to focus its message: when Ctrl+E opens the
// Explorer, and after a commit so Ctrl+Enter can push next. The box may mount (or remount, while
// the status catches up after a commit) only after the request, so a request stays live for a
// short window instead of being consumed. Expiring keeps a later switch to Changes from stealing
// focus when the Files tab was showing.
import { create } from "zustand";

const REQUEST_TTL_MS = 2000;

interface CommitMessageFocusState {
  requestedAt: number | null;
  request: () => void;
}

export const useCommitMessageFocusStore = create<CommitMessageFocusState>()((set) => ({
  requestedAt: null,
  request: () => set({ requestedAt: Date.now() }),
}));

export function isCommitMessageFocusRequested(requestedAt: number | null): boolean {
  return requestedAt !== null && Date.now() - requestedAt <= REQUEST_TTL_MS;
}
