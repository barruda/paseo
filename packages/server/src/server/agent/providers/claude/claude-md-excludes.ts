// CUSTOM(delegation-subagent-context): the delegation plugin puts a JSON list of CLAUDE.md paths in
// this launch env var; the Claude session passes it to the SDK as `claudeMdExcludes`.
export const CLAUDE_MD_EXCLUDES_ENV = "PASEO_CLAUDE_MD_EXCLUDES";

/** The list in the env var, or null when it is missing or not a JSON array of strings. */
export function parseClaudeMdExcludes(env: Record<string, string> | undefined): string[] | null {
  const raw = env?.[CLAUDE_MD_EXCLUDES_ENV];
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) return null;
    return parsed.length > 0 ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}
