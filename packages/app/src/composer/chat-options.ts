// CUSTOM(chat-options): stable keys for the composer rail, including plugin-contributed pills.
export const CHAT_OPTIONS = [
  ["parent", "Parent agent"],
  ["tasks", "Tasks"],
  ["subagents", "Subagents"],
  ["plugin:tldr:tldr", "TLDR"],
  ["commit", "Commit: wip"],
  ["rename", "Rename session"],
  ["plugin:skills:skills", "Skills/MCPs"],
  ["plugin:tell-agent:message-agent", "Tell agent"],
  ["plugin:token-ledger:ledger-pill", "TokenLedger"],
  ["diff", "Changes"],
  ["worktree", "Worktree"],
  ["git-sync", "Git sync"],
  ["reading", "Reading mode"],
] as const;

export function pluginChatOptionKey(pluginId: string, id: string, agentId: string): string {
  const suffix = `-${agentId}`;
  return `plugin:${pluginId}:${id.endsWith(suffix) ? id.slice(0, -suffix.length) : id}`;
}

export function chatOptionEnabled(options: Record<string, boolean>, key: string): boolean {
  return options[key] !== false;
}
