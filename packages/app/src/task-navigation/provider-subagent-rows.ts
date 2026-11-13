// CUSTOM(task-provider-subagents): the Tasks list shows an agent's provider subagents (Claude
// Code's Agent tool and the like) as a collapsed "N subagents" row under the agent's own row.
import equalWithMaps from "fast-deep-equal/es6";
import { useProviderSubagentStore } from "@/subagents/provider-store";
import { selectProviderSubagentsForParent, type ProviderSubagentRow } from "@/subagents/select";
import { buildSubagentRowPresentationData } from "@/subagents/track-presentation";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { TaskNode } from "./model";

export interface ProviderSubagentServerFlags {
  supported: boolean;
  nesting: boolean;
}

export type ProviderSubagentListRow =
  | {
      kind: "provider-subagents-toggle";
      key: string;
      parentKey: string;
      depth: number;
      label: string;
      expanded: boolean;
    }
  | {
      kind: "provider-subagent";
      key: string;
      parentKey: string;
      depth: number;
      serverId: string;
      workspaceId: string;
      parentAgentId: string;
      subagentId: string;
      label: string;
      subtitle: string;
      bucket: SidebarStateBucket | null;
    };

type ProviderSubagentStoreSnapshot = ReturnType<typeof useProviderSubagentStore.getState>;

/** Direct provider subagents per parent task key, oldest first, honoring each server's flags. */
export function groupProviderSubagentsByParent(
  state: ProviderSubagentStoreSnapshot,
  flagsByServer: Readonly<Record<string, ProviderSubagentServerFlags>>,
  taskKeyOf: (serverId: string, agentId: string) => string,
): Map<string, ProviderSubagentRow[]> {
  const result = new Map<string, ProviderSubagentRow[]>();
  const seen = new Set<string>();
  for (const [descriptorKey, subagent] of state.descriptors) {
    const serverId = descriptorKey.slice(0, descriptorKey.indexOf("\0"));
    const parentKey = taskKeyOf(serverId, subagent.parentAgentId);
    if (seen.has(parentKey)) continue;
    seen.add(parentKey);
    const flags = flagsByServer[serverId];
    if (!flags) continue;
    const rows = selectProviderSubagentsForParent(
      state,
      { serverId, parentAgentId: subagent.parentAgentId },
      flags.supported,
      flags.nesting,
    );
    if (rows.length > 0) result.set(parentKey, rows);
  }
  return result;
}

export function runningParentKeys(
  grouped: ReadonlyMap<string, readonly ProviderSubagentRow[]>,
): Set<string> {
  const keys = new Set<string>();
  for (const [parentKey, rows] of grouped) {
    if (rows.some((row) => buildSubagentRowPresentationData(row).statusBucket === "running"))
      keys.add(parentKey);
  }
  return keys;
}

function toggleLabel(rows: readonly ProviderSubagentRow[]): string {
  let working = 0;
  let failed = 0;
  for (const row of rows) {
    const bucket = buildSubagentRowPresentationData(row).statusBucket;
    if (bucket === "running") working += 1;
    if (bucket === "failed") failed += 1;
  }
  let label = `${rows.length} ${rows.length === 1 ? "subagent" : "subagents"}`;
  if (working > 0) label += ` · ${working} working`;
  if (failed > 0) label += ` · ${failed} failed`;
  return label;
}

/** The rows that follow one task row: the collapsed toggle, then the subagents when expanded. */
export function buildProviderSubagentRows(input: {
  node: TaskNode;
  depth: number;
  subagents: readonly ProviderSubagentRow[] | undefined;
  expanded: boolean;
}): ProviderSubagentListRow[] {
  const { node, depth, subagents, expanded } = input;
  if (!subagents || subagents.length === 0) return [];
  const rows: ProviderSubagentListRow[] = [
    {
      kind: "provider-subagents-toggle",
      key: `${node.key}\0subagents`,
      parentKey: node.key,
      depth: depth + 1,
      label: toggleLabel(subagents),
      expanded,
    },
  ];
  if (!expanded) return rows;
  const ordered = [...subagents].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  for (const subagent of ordered) {
    const presentation = buildSubagentRowPresentationData(subagent);
    rows.push({
      kind: "provider-subagent",
      key: `${node.key}\0subagent\0${subagent.id}`,
      parentKey: node.key,
      depth: depth + 2,
      serverId: node.agent.serverId,
      workspaceId: node.workspace.workspaceId,
      parentAgentId: subagent.parentAgentId,
      subagentId: subagent.id,
      label: presentation.label,
      subtitle: presentation.subtitle,
      bucket: presentation.statusBucket,
    });
  }
  return rows;
}

/**
 * Equality for `groupProviderSubagentsByParent` results. The plain `fast-deep-equal` sees every
 * Map as equal (it only compares own keys), so the list never updated past its first, empty value.
 */
export function equalProviderSubagentGroups(
  left: ReadonlyMap<string, readonly ProviderSubagentRow[]>,
  right: ReadonlyMap<string, readonly ProviderSubagentRow[]>,
): boolean {
  return equalWithMaps(left, right);
}
