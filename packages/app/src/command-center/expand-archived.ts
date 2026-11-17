// CUSTOM(search-expand-archived): when the palette offers to widen an agent search to archived
// agents, and which history entries become archived rows.
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

/**
 * The button shows only for a real query over the built-in agent list, once that list has
 * finished loading, and until the user has pressed it.
 */
export function shouldOfferArchivedExpansion(input: {
  query: string;
  scoped: boolean;
  agentsLoading: boolean;
  expanded: boolean;
}): boolean {
  return input.query.trim().length > 0 && !input.scoped && !input.agentsLoading && !input.expanded;
}

/** Archived fetching runs only while the palette is open, with a query, after the button. */
export function isArchivedExpansionActive(input: {
  open: boolean;
  query: string;
  expanded: boolean;
}): boolean {
  return input.expanded && input.open && input.query.trim().length > 0;
}

/** The expansion is forgotten when the palette closes or the query is cleared. */
export function shouldResetArchivedExpansion(input: { open: boolean; query: string }): boolean {
  return !input.open || input.query.trim().length === 0;
}

/** Archived sessions from history that the active agent list does not already show. */
export function selectArchivedAgents(
  historyAgents: readonly AggregatedAgent[],
  shownAgents: readonly Pick<AggregatedAgent, "id" | "serverId">[],
): AggregatedAgent[] {
  const shown = new Set(shownAgents.map((agent) => `${agent.serverId}:${agent.id}`));
  return historyAgents.filter(
    (agent) => Boolean(agent.archivedAt) && !shown.has(`${agent.serverId}:${agent.id}`),
  );
}
