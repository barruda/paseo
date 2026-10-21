import { existsSync } from "node:fs";
import { basename, dirname, join, parse, sep } from "node:path";

// CUSTOM(project-worktrees-root): Paseo puts a project's new worktrees in a `worktrees` folder
// beside the project, named after the project: `~/projetos/paseo` gets
// `~/projetos/worktrees/paseo-<slug>` instead of `$PASEO_HOME/worktrees/<hash>/<slug>`. The
// folder is created on the first worktree.

const PROJECT_WORKTREES_DIR = "worktrees";

export interface ProjectSiblingWorktrees {
  /** `<parent>/worktrees`, shared by every project in `<parent>`. */
  root: string;
  /** `<project>-`, prefixed to each worktree folder name. */
  prefix: string;
}

/** Where `repoRoot`'s worktrees go, or null for a repo at the filesystem root. */
export function resolveProjectSiblingWorktrees(repoRoot: string): ProjectSiblingWorktrees | null {
  const parent = dirname(repoRoot);
  if (parent === repoRoot || parent === parse(repoRoot).root) return null;
  return { root: join(parent, PROJECT_WORKTREES_DIR), prefix: `${basename(repoRoot)}-` };
}

/** `<project>-<slug>`, leaving a slug that already carries the prefix alone. */
export function projectSiblingWorktreeName(prefix: string, slug: string): string {
  return slug.startsWith(prefix) ? slug : `${prefix}${slug}`;
}

/**
 * Matches `<parent>/worktrees/<project>-<slug>[/...]` when `<parent>/<project>` is the worktree's
 * repository: `repoRoot` when git still knows it, otherwise any git checkout at that path (the
 * worktree's admin dir may already be gone mid-archive).
 */
export function matchProjectSiblingWorktree(
  cwd: string,
  repoRoot?: string,
): { worktreeRoot: string; worktreePath: string } | null {
  const parts = cwd.split(sep);
  for (let index = parts.length - 2; index >= 1; index -= 1) {
    if (parts[index] !== PROJECT_WORKTREES_DIR) continue;
    const parent = parts.slice(0, index).join(sep) || sep;
    const name = parts[index + 1]!;
    if (!isProjectWorktreeName(parent, name, repoRoot)) return null;
    const worktreeRoot = join(parent, PROJECT_WORKTREES_DIR);
    return { worktreeRoot, worktreePath: join(worktreeRoot, name) };
  }
  return null;
}

function isProjectWorktreeName(parent: string, name: string, repoRoot?: string): boolean {
  if (repoRoot) {
    const prefix = `${basename(repoRoot)}-`;
    return dirname(repoRoot) === parent && name.startsWith(prefix) && name.length > prefix.length;
  }
  for (let dash = name.indexOf("-"); dash > 0; dash = name.indexOf("-", dash + 1)) {
    if (dash < name.length - 1 && existsSync(join(parent, name.slice(0, dash), ".git"))) {
      return true;
    }
  }
  return false;
}
