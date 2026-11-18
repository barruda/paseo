// CUSTOM(hidden-board-agents): agents started by the Power Workboard plugin (and the ones the
// Projects Assistant starts) are "board agents". The app never opens them as tabs, hides them from
// the Tasks list unless asked, and neither the app nor the daemon notifies about them.
import { getParentAgentIdFromLabels } from "./agent-labels.js";

export const BOARD_AGENT_LABEL = "paseo.board-agent";
/** Set by the power-workboard plugin on the Projects Assistant chat. */
export const ASSISTANT_CHAT_LABEL = "pwb/assistant-chat";

const MAX_PARENT_HOPS = 4;

type Labels = Record<string, unknown> | null | undefined;

/**
 * True for an agent labeled as a board agent, or one whose parent chain (up to 4 hops) reaches a
 * board agent or the assistant chat. The assistant chat itself is not a board agent.
 */
export function isBoardAgent(labels: Labels, getLabelsById: (agentId: string) => Labels): boolean {
  if (labels?.[BOARD_AGENT_LABEL] === "true") {
    return true;
  }
  const seen = new Set<string>();
  let current = labels;
  for (let hop = 0; hop < MAX_PARENT_HOPS; hop += 1) {
    const parentId = getParentAgentIdFromLabels(current);
    if (!parentId || seen.has(parentId)) {
      return false;
    }
    seen.add(parentId);
    const parentLabels = getLabelsById(parentId);
    if (!parentLabels) {
      return false;
    }
    if (
      parentLabels[BOARD_AGENT_LABEL] === "true" ||
      parentLabels[ASSISTANT_CHAT_LABEL] === "true"
    ) {
      return true;
    }
    current = parentLabels;
  }
  return false;
}
