import type { AgentSnapshotPayload, ProjectPlacementPayload } from "@getpaseo/protocol/messages";
import {
  type HistoryQuery,
  type HistoryQueryTerm,
  parseHistoryQuery,
  textContainsHistoryTerm,
} from "@getpaseo/protocol/search/history-query";
import { scoreTextFields } from "@getpaseo/protocol/search/text-match";

export interface AgentHistorySearchCandidate {
  agent: AgentSnapshotPayload;
  project: ProjectPlacementPayload;
}

// CUSTOM(history-content-search): "excluded" beats a message match, so it is its own result.
export type AgentHistoryNameMatch = "match" | "miss" | "excluded";

function historyNames({ agent, project }: AgentHistorySearchCandidate): string[] {
  return [
    project.workspaceName ?? "",
    agent.title ?? "",
    project.checkout.currentBranch ?? "",
    project.projectName,
  ];
}

// Unquoted terms keep the typo tolerance people rely on when recalling a title; quoted and
// excluded terms match as written, so `-ui` never drops every title with a u before an i.
function namesMatchTerm(names: string[], term: HistoryQueryTerm): boolean {
  if (term.exact) return names.some((name) => textContainsHistoryTerm(name, term));
  return scoreTextFields(term.text, names, { typoTolerant: true }) !== null;
}

/** Search the names people recall, never an incomplete subset of transcripts. */
export function matchAgentHistoryNames(
  query: HistoryQuery,
  candidate: AgentHistorySearchCandidate,
): AgentHistoryNameMatch {
  const names = historyNames(candidate);
  if (query.excluded.some((term) => names.some((name) => textContainsHistoryTerm(name, term)))) {
    return "excluded";
  }
  const matches = query.required.every((group) =>
    group.some((term) => namesMatchTerm(names, term)),
  );
  return matches ? "match" : "miss";
}

export function matchesAgentHistoryQuery(
  query: string,
  candidate: AgentHistorySearchCandidate,
): boolean {
  return matchAgentHistoryNames(parseHistoryQuery(query), candidate) === "match";
}
