// CUSTOM(worktree-pill): the commands and label behind the "Worktree: <branch>" pill.

/**
 * Commits everything in the worktree as "wip" (skipped when there is nothing to commit), then
 * merges the worktree's branch into the main checkout. The main checkout is the parent of the
 * shared git dir, so it needs no daemon field and works for worktrees Paseo did not create.
 */
export const MERGE_WORKTREE_COMMAND = [
  "git add -A",
  "{ git diff --cached --quiet || git commit -m 'wip'; }",
  "branch=$(git rev-parse --abbrev-ref HEAD)",
  'main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")',
  'echo "Merging $branch into $main"',
  'cd "$main"',
  'git merge --no-edit "$branch"',
].join(" && ");

export function resolveWorktreePillLabel(input: {
  currentBranch: string | null | undefined;
  workspaceName: string;
}): string {
  return `Worktree: ${input.currentBranch?.trim() || input.workspaceName}`;
}

function trimTrailingSlash(path: string | null | undefined): string {
  return (path ?? "").trim().replace(/\/+$/, "");
}

/**
 * True for a linked git worktree, false for the main checkout. The main checkout can also report
 * kind "worktree" (its main repo root is itself), so the checkout's `mainRepoRoot` decides: a
 * worktree registered as its own project (opened by its folder, like `~/uprojects/DreamMMO-wt1`)
 * has its directory equal to the project root, yet a main repo root elsewhere.
 */
export function isLinkedWorktreeWorkspace(input: {
  workspaceKind: string;
  directory: string;
  projectRootPath: string;
  checkout?: { mainRepoRoot?: string | null; worktreeRoot?: string | null } | null;
}): boolean {
  if (input.workspaceKind !== "worktree") return false;
  const mainRepoRoot = trimTrailingSlash(input.checkout?.mainRepoRoot);
  if (!mainRepoRoot) return input.directory !== input.projectRootPath;
  return (
    mainRepoRoot !== trimTrailingSlash(input.directory) &&
    mainRepoRoot !== trimTrailingSlash(input.checkout?.worktreeRoot)
  );
}

/**
 * CUSTOM(git-sync): merges the branch the main checkout has checked out into this worktree. It
 * commits nothing first: git refuses (and changes nothing) when an uncommitted change is in the way.
 */
export const PULL_FROM_MAIN_COMMAND = [
  'main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")',
  'branch=$(git -C "$main" symbolic-ref --short -q HEAD)',
  'if [ -z "$branch" ]; then echo "The main project ($main) has no branch checked out"; false',
  'else echo "Merging $branch from $main into $(git rev-parse --abbrev-ref HEAD)" && git merge --no-edit "$branch"; fi',
].join("; ");

/**
 * CUSTOM(git-sync): "Sync projects": commits the worktree's changes as "wip", merges its branch
 * into the main checkout's branch, then merges that branch back here, so both end on the same
 * work. Stops at the first step that fails or conflicts.
 */
export const SYNC_PROJECTS_COMMAND = [
  "git add -A",
  "{ git diff --cached --quiet || git commit -m 'wip'; }",
  "branch=$(git rev-parse --abbrev-ref HEAD)",
  'main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")',
  '{ mainBranch=$(git -C "$main" symbolic-ref --short -q HEAD) || { echo "The main project ($main) has no branch checked out"; false; }; }',
  'echo "1/2 Merging $branch into $mainBranch ($main)"',
  'git -C "$main" merge --no-edit "$branch"',
  'echo "2/2 Merging $mainBranch back into $branch"',
  'git merge --no-edit "$mainBranch"',
].join(" && ");
