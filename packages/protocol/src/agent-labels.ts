import type { AgentAddress } from "./addresses.js";
export const PARENT_SERVER_ID_LABEL = "paseo.parent-server-id";
export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
const OPEN_AGENT_TAB_LABEL_PREFIX = "paseo.open-agent-tab.";

export function getOpenAgentTabLabel(clientId: string): string {
  return `${OPEN_AGENT_TAB_LABEL_PREFIX}${clientId}`;
}

export function isOpenAgentTabLabel(label: string): boolean {
  return label.startsWith(OPEN_AGENT_TAB_LABEL_PREFIX);
}

// CUSTOM(idle-closed-tab): clients label each agent "true" while they have a tab open for it and
// "false" after. Separate from the open-agent-tab label, which drives the subagent archive cascade.
export const IDLE_TAB_LABEL_PREFIX = "paseo.idle-open-tab.";

export function getIdleOpenTabLabel(clientId: string): string {
  return `${IDLE_TAB_LABEL_PREFIX}${clientId}`;
}

export function hasIdleOpenTab(labels: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => label.startsWith(IDLE_TAB_LABEL_PREFIX) && value === "true",
  );
}

// CUSTOM(auto-archive-skip-pinned): clients label each agent "true" while they have it pinned in the
// Tasks sidebar and "false" after. The daemon never auto-archives a pinned agent or its worktree,
// and stamps UNPINNED_AT_LABEL when the last pin goes so the idle clock restarts from the unpin.
export const PINNED_LABEL_PREFIX = "paseo.pinned.";
export const UNPINNED_AT_LABEL = "paseo.unpinned-at";

export function getPinnedLabel(clientId: string): string {
  return `${PINNED_LABEL_PREFIX}${clientId}`;
}

export function hasPinnedLabel(labels: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => label.startsWith(PINNED_LABEL_PREFIX) && value === "true",
  );
}

/** Milliseconds of the last unpin, or null when the agent was never unpinned. */
export function getUnpinnedAt(labels: Record<string, unknown> | null | undefined): number | null {
  const value = labels?.[UNPINNED_AT_LABEL];
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** `after` with UNPINNED_AT_LABEL set to `nowIso` when this change removed the last pin. */
export function stampUnpin(
  before: Record<string, string>,
  after: Record<string, string>,
  nowIso: string,
): Record<string, string> {
  if (!hasPinnedLabel(before) || hasPinnedLabel(after)) return after;
  return { ...after, [UNPINNED_AT_LABEL]: nowIso };
}

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  const parentAgentId = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof parentAgentId === "string" && parentAgentId.trim().length > 0
    ? parentAgentId.trim()
    : null;
}

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}

export function hasOpenAgentTab(labels: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => isOpenAgentTabLabel(label) && value === "true",
  );
}

// Absent parent server label means the same host.
export function getParentAddressFromLabels(
  labels: Record<string, unknown> | null | undefined,
  serverId: string,
): AgentAddress | null {
  const agentId = getParentAgentIdFromLabels(labels);
  if (!agentId) return null;
  const parentServerId = labels?.[PARENT_SERVER_ID_LABEL];
  return {
    serverId:
      typeof parentServerId === "string" && parentServerId.trim()
        ? parentServerId.trim()
        : serverId,
    agentId,
  };
}
export function parentAddressLabels(parent: AgentAddress): Record<string, string> {
  return { [PARENT_AGENT_ID_LABEL]: parent.agentId, [PARENT_SERVER_ID_LABEL]: parent.serverId };
}
