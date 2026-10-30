import type { AgentAddress } from "@getpaseo/protocol/addresses";
import { memo, useCallback, type ReactElement } from "react";
import { COMMIT_WIP_PILL_ALWAYS_SHOWN, CommitWipPill } from "@/composer/commit-wip-pill";
import { WorkspaceDiffStatPill } from "@/composer/diff-stat-pill";
import { RenameSessionPill } from "@/composer/rename-session-pill";
import { ReadingModePill } from "@/agent-stream/reading-modes/pill";
import { WorktreePill } from "@/composer/worktree-pill";
import { useAgentStatusSummary } from "@/composer/agent-status-line";
import { useWorkspaceHasDiffStat } from "@/composer/workspace-diff-stat";
import { AgentTaskList } from "@/composer/task-list";
import { ComposerTrackBar } from "@/composer/tracks";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePaneContext } from "@/panels/pane-context";
import { useSettings } from "@/hooks/use-settings";
import { PluginComposerPills } from "@/plugins";
import { useSessionStore } from "@/stores/session-store";
import {
  type ArchiveFinishedStatus,
  useArchiveSubagent,
  useDetachSubagent,
  useSubagentSheetTab,
  type SubagentRow,
} from "@/subagents";
import { ParentAgentPill } from "@/subagents/parent";
import { SubagentsTrack } from "@/subagents/track";
import type { TodoEntry } from "@/types/stream";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";
import { openPreferredWorkspaceTarget } from "@/workspace-tabs/open-beside";
import { openComposerChanges } from "@/workspace-tabs/open-supporting-view";

/**
 * The pane's ambient context — workspace changes, subagents, and tasks — as a row of pills above
 * the composer.
 *
 * The row shares the composer's keyboard transform and owns the space between itself and the
 * transcript. Each pill owns its action while tab placement stays behind the workspace boundary.
 */
export const AgentTracks = memo(function AgentTracks({
  serverId,
  workspaceId,
  agentId,
  cwd,
  parentAgentId,
  subagentRows,
  tasks,
  archiveFinishedStatus,
  onArchiveFinished,
  hasPluginComposerPills,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  /** CUSTOM(worktree-pill): the checkout the Worktree pill acts on. */
  cwd: string;
  parentAgentId: string | null;
  subagentRows: SubagentRow[];
  tasks: TodoEntry[] | undefined;
  archiveFinishedStatus: ArchiveFinishedStatus;
  onArchiveFinished: () => void;
  hasPluginComposerPills: boolean;
}): ReactElement | null {
  const { tabId } = usePaneContext();
  const hasWorkspaceDiffStat = useWorkspaceHasDiffStat(serverId, workspaceId);
  // CUSTOM(worktree-pill-done): a done worktree session leads the row with a green Worktree pill.
  const statusSummary = useAgentStatusSummary(serverId, agentId);
  const isDone = statusSummary?.done === true;
  // CUSTOM(worktree-pill-merged): done and already merged into the main checkout.
  const isMerged = isDone && statusSummary?.merged === true;
  const isCompact = useIsCompactFormFactor();
  const openInSidePane = useSettings((settings) => settings.openInSidePane);
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const canDetachSubagents = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentDetach === true,
  );
  const archiveSubagent = useArchiveSubagent();
  const detachSubagent = useDetachSubagent();
  const openSubagentTarget = useCallback(
    (target: WorkspaceTabTarget) => {
      openPreferredWorkspaceTarget({
        workspaceKey,
        target,
        source: "subagents",
        preferences: openInSidePane,
        parentTabId: tabId,
      });
    },
    [openInSidePane, tabId, workspaceKey],
  );
  const handleOpenSubagent = useCallback(
    ({ serverId: targetServerId, agentId: subagentId }: AgentAddress) => {
      const session = useSessionStore.getState().sessions[targetServerId];
      const agent = session?.agents.get(subagentId) ?? session?.agentDetails.get(subagentId);
      // A subagent in another workspace lives in that workspace's tabs.
      if (
        targetServerId !== serverId ||
        (agent?.workspaceId && agent.workspaceId !== workspaceId)
      ) {
        navigateToAgent({ serverId: targetServerId, agentId: subagentId });
        return;
      }
      openSubagentTarget({ kind: "agent", agentId: subagentId });
    },
    [openSubagentTarget, serverId, workspaceId],
  );
  const handleOpenProviderSubagent = useCallback(
    (ownerAgentId: string, subagentId: string) => {
      openSubagentTarget({
        kind: "provider_subagent",
        parentAgentId: ownerAgentId,
        subagentId,
      });
    },
    [openSubagentTarget],
  );
  const sheetTabFor = useSubagentSheetTab(workspaceKey, tabId);
  const handleOpenChanges = useCallback(() => {
    if (!workspaceKey) {
      return;
    }
    openComposerChanges({
      isCompact,
      workspaceKey,
      preferences: openInSidePane,
    });
  }, [isCompact, openInSidePane, workspaceKey]);

  if (
    !hasWorkspaceDiffStat &&
    !hasAgentTracks({
      parentAgentId,
      subagentRows,
      tasks,
      archiveFinishedStatus,
      hasPluginComposerPills,
    })
  ) {
    return null;
  }

  return (
    <ComposerTrackBar>
      {/* CUSTOM(worktree-pill-done) */}
      {isDone ? (
        <WorktreePill
          serverId={serverId}
          workspaceId={workspaceId}
          agentId={agentId}
          cwd={cwd}
          done
          merged={isMerged}
        />
      ) : null}
      {parentAgentId ? <ParentAgentPill serverId={serverId} parentAgentId={parentAgentId} /> : null}
      <AgentTaskList tasks={tasks} />
      <SubagentsTrack
        serverId={serverId}
        rows={subagentRows}
        onOpenSubagent={handleOpenSubagent}
        onOpenProviderSubagent={handleOpenProviderSubagent}
        sheetTabFor={sheetTabFor}
        onArchiveSubagent={archiveSubagent}
        onArchiveFinished={onArchiveFinished}
        archiveFinishedStatus={archiveFinishedStatus}
        onDetachSubagent={canDetachSubagents ? detachSubagent : undefined}
      />
      {/* CUSTOM(pill-order): TLDR, Commit: wip and Rename session lead the row. */}
      <PluginComposerPills
        serverId={serverId}
        workspaceId={workspaceId}
        agentId={agentId}
        compact={isCompact}
        leading
      />
      {/* CUSTOM(commit-wip): commits everything as "wip". */}
      <CommitWipPill serverId={serverId} workspaceId={workspaceId} agentId={agentId} />
      {/* CUSTOM(session-auto-rename): names the session from its status summary. */}
      <RenameSessionPill serverId={serverId} agentId={agentId} />
      <PluginComposerPills
        serverId={serverId}
        workspaceId={workspaceId}
        agentId={agentId}
        compact={isCompact}
        leading={false}
      />
      <WorkspaceDiffStatPill
        serverId={serverId}
        workspaceId={workspaceId}
        onPress={handleOpenChanges}
      />
      {/* CUSTOM(worktree-pill): copies the worktree path or merges it into the main checkout. */}
      {isDone ? null : (
        <WorktreePill serverId={serverId} workspaceId={workspaceId} agentId={agentId} cwd={cwd} />
      )}
      {/* CUSTOM(reading-modes): Columns and Compact, at the right end. */}
      <ReadingModePill agentId={agentId} />
    </ComposerTrackBar>
  );
});

export function hasAgentTracks({
  parentAgentId,
  subagentRows,
  tasks,
  archiveFinishedStatus,
  hasPluginComposerPills = false,
}: {
  parentAgentId: string | null;
  subagentRows: readonly SubagentRow[];
  tasks: readonly TodoEntry[] | undefined;
  archiveFinishedStatus: ArchiveFinishedStatus;
  hasPluginComposerPills?: boolean;
}): boolean {
  return (
    // CUSTOM(commit-wip): Commit: wip shows with or without changes, so the row always does.
    COMMIT_WIP_PILL_ALWAYS_SHOWN ||
    parentAgentId !== null ||
    subagentRows.length > 0 ||
    Boolean(tasks?.length) ||
    archiveFinishedStatus.kind !== "idle" ||
    hasPluginComposerPills
  );
}
