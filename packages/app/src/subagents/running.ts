// CUSTOM(subagent-tab-status): an agent's tab shows as working while one of its subagents runs,
// even after the agent's own turn ended. The sidebar's workspace status already counts running
// subagents (docs/agent-lifecycle.md, "Workspace activity"); the tab now agrees with it.
import { useMemo } from "react";
import { usePendingArchiveAgentKeys } from "@/hooks/use-archive-agent";
import { useSessionStore } from "@/stores/session-store";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { useProviderSubagentStore } from "./provider-store";
import {
  createSubagentsForParentSelector,
  selectProviderSubagentsForParent,
  type SubagentRow,
} from "./select";
import { buildSubagentRowPresentationData } from "./track-presentation";

/** Same rule as the track pill's "N working" count. */
export function hasRunningSubagent(rows: readonly SubagentRow[]): boolean {
  return rows.some((row) => buildSubagentRowPresentationData(row).statusBucket === "running");
}

/**
 * The agent's own bucket, raised to `running` while a subagent works. The agent's own
 * needs_input and failed still win, the same priority a collapsed project row uses.
 */
export function withRunningSubagents(
  bucket: SidebarStateBucket | null,
  subagentRunning: boolean,
): SidebarStateBucket | null {
  if (!subagentRunning) return bucket;
  if (bucket === "done" || bucket === "attention") return "running";
  return bucket;
}

/**
 * Reads the stores only. The track refreshes provider subagents when the pane mounts, and the
 * daemon pushes provider subagent updates to every client, so tabs never opened stay current.
 */
export function useHasRunningSubagent(serverId: string, agentId: string): boolean {
  const pendingArchiveIds = usePendingArchiveAgentKeys();
  const selectPaseoRows = useMemo(
    () => createSubagentsForParentSelector({ serverId, parentAgentId: agentId }, pendingArchiveIds),
    [serverId, agentId, pendingArchiveIds],
  );
  const paseoRunning = useSessionStore((state) => hasRunningSubagent(selectPaseoRows(state)));
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const nestingSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.providerSubagentNesting === true,
  );
  const providerRunning = useProviderSubagentStore((state) =>
    hasRunningSubagent(
      selectProviderSubagentsForParent(
        state,
        { serverId, parentAgentId: agentId },
        supported,
        nestingSupported,
      ),
    ),
  );
  return paseoRunning || providerRunning;
}
