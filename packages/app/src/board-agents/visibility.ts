// CUSTOM(hidden-board-agents): resolves board-agent status from the agents loaded in a session.
import { isBoardAgent } from "@getpaseo/protocol/board-agents";
import type { Agent } from "@/stores/session-store";

export function isBoardAgentInSession(
  agent: { labels: Record<string, string> },
  agents: Map<string, Agent> | undefined,
  agentDetails?: Map<string, Agent>,
): boolean {
  return isBoardAgent(
    agent.labels,
    (id) => agents?.get(id)?.labels ?? agentDetails?.get(id)?.labels,
  );
}
