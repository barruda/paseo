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
