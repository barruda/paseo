import { slugify } from "@getpaseo/protocol/branch-slug";
import { createNameId } from "mnemonic-id";
import { create } from "zustand";

// CUSTOM(draft-worktree): a new session in Tasks mode can start in a new worktree of its project
// instead of the project's own checkout. The choice lives here, per draft, until the session is
// created.

export type DraftIsolation = "local" | "worktree";

export interface DraftWorktreeChoice {
  isolation: DraftIsolation;
  /** What the user typed; blank means the daemon names it from the first message. */
  name: string;
  /** The branch to start from; null until edited, which means the checkout's current branch. */
  baseBranch: string | null;
}

/** Where a draft's worktree comes from: its project and the branch its checkout is on. */
export interface DraftWorktreeSource {
  projectId: string;
  currentBranch: string | null;
}

export interface DraftWorktreeRequest {
  projectId: string;
  name: string;
  /** Unset lets the daemon branch off the repository's default branch. */
  baseBranch?: string;
}

const DEFAULT_CHOICE: DraftWorktreeChoice = { isolation: "local", name: "", baseBranch: null };

interface DraftWorktreeStore {
  byDraftId: Record<string, DraftWorktreeChoice>;
  setIsolation: (draftId: string, isolation: DraftIsolation) => void;
  setName: (draftId: string, name: string) => void;
  setBaseBranch: (draftId: string, baseBranch: string) => void;
  clear: (draftId: string) => void;
}

export const useDraftWorktreeStore = create<DraftWorktreeStore>((set) => {
  const update = (draftId: string, patch: (current: DraftWorktreeChoice) => DraftWorktreeChoice) =>
    set((state) => ({
      byDraftId: {
        ...state.byDraftId,
        [draftId]: patch(state.byDraftId[draftId] ?? DEFAULT_CHOICE),
      },
    }));
  return {
    byDraftId: {},
    setIsolation: (draftId, isolation) => update(draftId, (current) => ({ ...current, isolation })),
    // Typing in either field picks the worktree, so there is nothing to click first.
    setName: (draftId, name) =>
      update(draftId, (current) => ({
        ...current,
        isolation: name.trim() ? "worktree" : current.isolation,
        name,
      })),
    setBaseBranch: (draftId, baseBranch) =>
      update(draftId, (current) => ({ ...current, isolation: "worktree", baseBranch })),
    clear: (draftId) =>
      set((state) => {
        const { [draftId]: _removed, ...rest } = state.byDraftId;
        return { byDraftId: rest };
      }),
  };
});

export function useDraftWorktreeChoice(draftId: string): DraftWorktreeChoice {
  return useDraftWorktreeStore((state) => state.byDraftId[draftId] ?? DEFAULT_CHOICE);
}

export function getDraftWorktreeChoice(draftId: string): DraftWorktreeChoice {
  return useDraftWorktreeStore.getState().byDraftId[draftId] ?? DEFAULT_CHOICE;
}

/** The branch a worktree starts from: the edited one, else the checkout's current branch. */
export function resolveDraftBaseBranch(
  choice: DraftWorktreeChoice,
  source: DraftWorktreeSource,
): string | null {
  return choice.baseBranch?.trim() || source.currentBranch || null;
}

/** The worktree a submit should create, or null to start in the draft's own workspace. */
export function resolveDraftWorktreeRequest(
  draftId: string,
  source: DraftWorktreeSource | null,
): DraftWorktreeRequest | null {
  const choice = getDraftWorktreeChoice(draftId);
  if (choice.isolation !== "worktree" || !source) return null;
  const baseBranch = resolveDraftBaseBranch(choice, source);
  return {
    projectId: source.projectId,
    name: choice.name,
    ...(baseBranch ? { baseBranch } : {}),
  };
}

/**
 * The worktree directory slug and branch for a typed name. A blank name gets a random placeholder
 * slug and no branch name, which leaves the branch to the daemon's first-message auto-name.
 */
export function resolveDraftWorktreeNames(
  name: string,
  createPlaceholder: () => string = createNameId,
): { worktreeSlug: string; branchName?: string } {
  const slug = slugify(name);
  if (!slug) return { worktreeSlug: createPlaceholder() };
  return { worktreeSlug: slug, branchName: slug };
}
