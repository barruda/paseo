// CUSTOM(sidebar-agent-tabs): the Tasks sidebar splits every agent into three tabs. An orchestrator
// is a chat the board owns or a root board agent (the agent the board starts for a task); a worker
// descends from an orchestrator; every other agent is the user's.
import {
  ASSISTANT_CHAT_LABEL,
  BOARD_AGENT_LABEL,
  REFINEMENT_CHAT_LABEL,
} from "@getpaseo/protocol/board-agents";
import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";

export type SidebarAgentTab = "user" | "orchestrators" | "workers";

export interface SidebarClassifiableAgent {
  labels?: Record<string, unknown> | null;
  parentAgentId?: string | null;
  title?: string | null;
}

const MAX_PARENT_HOPS = 4;

/**
 * The tab an agent belongs to. A board-labeled agent with a parent is a worker; without one it is
 * the orchestrator the board started for a task. The board's chats are orchestrators even though
 * they carry no board label. A descendant of either is a worker, including one that forgot the
 * board label.
 */
export function classifySidebarAgent(
  agent: SidebarClassifiableAgent,
  getAgent: (id: string) => SidebarClassifiableAgent | undefined,
): SidebarAgentTab {
  if (isOrchestratorChat(agent)) return "orchestrators";
  if (agent.labels?.[BOARD_AGENT_LABEL] === "true") {
    return parentAgentIdOf(agent) ? "workers" : "orchestrators";
  }
  return hasOrchestratorAncestor(agent, getAgent) ? "workers" : "user";
}

export function isOrchestratorChat(agent: SidebarClassifiableAgent): boolean {
  return (
    agent.labels?.[ASSISTANT_CHAT_LABEL] === "true" ||
    agent.labels?.[REFINEMENT_CHAT_LABEL] === "true" ||
    // Refinement chats created before the plugin labeled them.
    (agent.title?.startsWith("Refine: ") ?? false)
  );
}

function parentAgentIdOf(agent: SidebarClassifiableAgent): string | null {
  return getParentAgentIdFromLabels(agent.labels) ?? agent.parentAgentId ?? null;
}

function hasOrchestratorAncestor(
  agent: SidebarClassifiableAgent,
  getAgent: (id: string) => SidebarClassifiableAgent | undefined,
): boolean {
  const seen = new Set<string>();
  let current = agent;
  for (let hop = 0; hop < MAX_PARENT_HOPS; hop += 1) {
    const parentId = parentAgentIdOf(current);
    if (!parentId || seen.has(parentId)) return false;
    seen.add(parentId);
    const parent = getAgent(parentId);
    if (!parent) return false;
    if (isOrchestratorChat(parent) || parent.labels?.[BOARD_AGENT_LABEL] === "true") return true;
    current = parent;
  }
  return false;
}
