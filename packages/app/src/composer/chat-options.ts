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
  ["mode", "Agent permissions"],
  ["feature:fast_mode", "Fast mode"],
  ["feature:plan_mode", "Plan mode"],
  ["feature:other", "Other agent features"],
  ["model-shortcut", "Model shortcut (Ctrl+M)"],
  ["cache-warmup", "Keep cache warm"],
  ["critic", "Critic"],
  ["jev", "Jev router"],
  ["delegation", "Delegation"],
  ["branch", "Git branch"],
  ["project", "Project icon"],
  ["context-meter", "Context usage"],
  ["dictation", "Dictation"],
  ["voice", "Voice mode"],
  ["send", "Send message"],
  ["stop", "Stop agent"],
] as const;

export function featureChatOptionKey(id: string): string {
  return id === "fast_mode" || id === "plan_mode" ? `feature:${id}` : "feature:other";
}

export function pluginChatOptionKey(pluginId: string, id: string, agentId: string): string {
  const suffix = `-${agentId}`;
  return `plugin:${pluginId}:${id.endsWith(suffix) ? id.slice(0, -suffix.length) : id}`;
}

export function chatOptionEnabled(options: Record<string, boolean>, key: string): boolean {
  return options[key] !== false;
}
