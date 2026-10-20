/** What the pill sends to the agent, as if typed in the composer. */
export const TLDR_PROMPT = "TLDR";

export interface TldrAgent {
  id: string;
  workspaceId?: string | null;
  status: string;
  archivedAt?: string | null;
}

/** The workspace the agent's TLDR pill belongs to, or null when it gets no pill. */
export function tldrPillWorkspace(agent: TldrAgent): string | null {
  if (!agent.workspaceId || agent.archivedAt || agent.status === "closed") return null;
  return agent.workspaceId;
}
