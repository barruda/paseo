import path from "node:path";

/** Env var the plugin sets on a Claude subagent; the Claude provider turns it into `claudeMdExcludes`. */
export const CLAUDE_MD_EXCLUDES_ENV = "PASEO_CLAUDE_MD_EXCLUDES";

/** Env var the plugin sets on a Codex subagent; the Codex provider turns it into `project_doc_max_bytes`. */
export const CODEX_AGENTS_MD_ENV = "PASEO_CODEX_AGENTS_MD";

/**
 * The CLAUDE.md files a Claude subagent should not load in `project` mode: the user's config dir
 * and everything in the directories above the project root. The project's own files stay.
 */
export function buildClaudeMdExcludes(input: { projectRoot: string; configDir: string }): string[] {
  const configDir = path.resolve(input.configDir);
  const list = [`${configDir}/CLAUDE.md`, `${configDir}/rules/**`];
  let ancestor = path.dirname(path.resolve(input.projectRoot));
  for (;;) {
    const base = ancestor === "/" ? "" : ancestor;
    list.push(
      `${base}/CLAUDE.md`,
      `${base}/CLAUDE.local.md`,
      `${base}/.claude/CLAUDE.md`,
      `${base}/.claude/rules/**`,
    );
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return [...new Set(list)];
}
