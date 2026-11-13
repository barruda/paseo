// CUSTOM(delegation-subagent-context): the delegation plugin puts "none" in this launch env var on
// a Codex subagent created through Paseo; the Codex session turns it into config for the thread.
export const CODEX_AGENTS_MD_ENV = "PASEO_CODEX_AGENTS_MD";

/**
 * Codex config that drops the repo's AGENTS.md files. Codex has no setting for the global
 * `$CODEX_HOME/AGENTS.md`, so that one is still read.
 */
export function codexAgentsMdConfig(env: Record<string, string> | undefined): {
  project_doc_max_bytes?: number;
} {
  return env?.[CODEX_AGENTS_MD_ENV] === "none" ? { project_doc_max_bytes: 0 } : {};
}
