import type { AgentAddress } from "@getpaseo/protocol/addresses";
import { Fragment, memo, useCallback, useMemo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { COMMIT_WIP_PILL_ALWAYS_SHOWN, CommitWipPill } from "@/composer/commit-wip-pill";
import { WorkspaceDiffStatPill } from "@/composer/diff-stat-pill";
import { RenameSessionPill } from "@/composer/rename-session-pill";
import { ReadingModePill } from "@/agent-stream/reading-modes/pill";
import { WorktreePill } from "@/composer/worktree-pill";
import { GitSyncTrailingPills } from "@/git-sync/pills"; // CUSTOM(git-sync)
import { useGitSync } from "@/git-sync/use-git-sync"; // CUSTOM(git-sync)
import { useAgentStatusSummary } from "@/composer/agent-status-line";
import { useWorkspaceHasDiffStat } from "@/composer/workspace-diff-stat";
import { BackgroundWorkTrack, createHostBackgroundWorkModel } from "@/background-work";
import type { ArchiveFinishedStatus } from "@/subagents/archive-finished";
import { AgentTaskList } from "@/composer/task-list";
import { ComposerTrackBar } from "@/composer/tracks";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePaneContext } from "@/panels/pane-context";
import { useSettings } from "@/hooks/use-settings";
import {
  PluginComposerPill,
  useHasPluginComposerPills,
  usePluginComposerPillEntries,
} from "@/plugins";
import { useSessionStore } from "@/stores/session-store";
import {
  useArchiveFinishedSubagents,
  useArchiveSubagent,
  useDetachSubagent,
  useSubagentSheetTab,
  type SubagentRow,
  useSubagentsForParent,
} from "@/subagents";
import { ParentAgentPill } from "@/subagents/parent";
import { SubagentsTrack } from "@/subagents/track";
import { openSubagentTab } from "@/subagents/open-tab";
import { BackgroundToolsTrack, useAgentBackgroundTools } from "@/background-tools/track"; // CUSTOM(background-tools)
import { hasBackgroundTools } from "@/background-tools/presentation"; // CUSTOM(background-tools)
import type { TodoEntry } from "@/types/stream";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";
import { openComposerChanges } from "@/workspace-tabs/open-supporting-view";
import { chatOptionEnabled, defaultAboveOrder, orderChatOptions } from "@/composer/chat-options";
// CUSTOM(assistant-restart-pill), CUSTOM(pm-composer-pills): the right-aligned group, and the
// Project Manager chat's leaner row.
import { layoutAboveRow } from "@/composer/project-manager-pills";
import { isAssistantChatAgent } from "@/assistant-sidebar/model";

/**
 * The pane's ambient context — workspace changes, subagents, and tasks — as a row of pills above
 * the composer.
 *
 * The row shares the composer's keyboard transform and owns the space between itself and the
 * transcript. Each pill owns its action while tab placement stays behind the workspace boundary.
 */
// Each independently configurable pill contributes one render branch.
// eslint-disable-next-line complexity
export const AgentTracks = memo(function AgentTracks({
  serverId,
  workspaceId,
  agentId,
  cwd,
  parentAgentId,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  /** CUSTOM(worktree-pill): the checkout the Worktree pill acts on. */
  cwd: string;
  parentAgentId: string | null;
}): ReactElement | null {
  const subagentRows = useSubagentsForParent({ serverId, parentAgentId: agentId });
  const tasks = useSessionStore((state): TodoEntry[] | undefined =>
    state.sessions[serverId]?.agentTasks.get(agentId),
  );
  const archiveFinishedSubagents = useArchiveFinishedSubagents({
    serverId,
    parentAgentId: agentId,
    rows: subagentRows,
  });
  const { tabId } = usePaneContext();
  const hasWorkspaceDiffStat = useWorkspaceHasDiffStat(serverId, workspaceId);
  // CUSTOM(worktree-pill-done): a done worktree session leads the row with a green Worktree pill.
  const statusSummary = useAgentStatusSummary(serverId, agentId);
  const isDone = statusSummary?.done === true;
  // CUSTOM(worktree-pill-merged): done and already merged into the main checkout.
  const isMerged = isDone && statusSummary?.merged === true;
  // CUSTOM(git-sync): conflicts and worktrees to bring in, for the git chips.
  const gitSync = useGitSync({ serverId, workspaceId, agentId });
  const backgroundTools = useAgentBackgroundTools(serverId, agentId); // CUSTOM(background-tools)
  // CUSTOM(pm-composer-pills): the Project Manager chat drops commit, rename and the disk warning.
  const isProjectManager = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return isAssistantChatAgent(session?.agents.get(agentId) ?? session?.agentDetails.get(agentId));
  });
  const backgroundWorkCount = useSessionStore((state) => {
    const session = state.sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    return agent?.backgroundWork?.count ?? 0;
  });
  const backgroundModel = useMemo(
    () => createHostBackgroundWorkModel(serverId, agentId),
    [serverId, agentId],
  );
  const isCompact = useIsCompactFormFactor();
  const openInSidePane = useSettings((settings) => settings.openInSidePane);
  const options = useSettings((settings) => settings.chatOptions);
  const orderSetting = useSettings((settings) => settings.chatOptionOrder);
  const pluginPills = usePluginComposerPillEntries(serverId, workspaceId, agentId);
  const hasPluginComposerPills = useHasPluginComposerPills(serverId, workspaceId, agentId);
  const show = (key: string) => chatOptionEnabled(options, key);
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const canDetachSubagents = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentDetach === true,
  );
  const archiveSubagent = useArchiveSubagent();
  const detachSubagent = useDetachSubagent();
  const openSubagentTarget = useCallback(
    (target: WorkspaceTabTarget) => {
      openSubagentTab({
        workspaceKey,
        target,
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
    !(show("diff") && hasWorkspaceDiffStat) &&
    !hasAgentTracks({
      parentAgentId,
      subagentRows,
      tasks,
      archiveFinishedStatus: archiveFinishedSubagents.status,
      hasPluginComposerPills,
      options,
      hasBackgroundToolsRunning: hasBackgroundTools(backgroundTools),
      hasBackgroundWork: backgroundWorkCount > 0,
    })
  ) {
    return null;
  }

  // CUSTOM(chat-options): every pill is a keyed node, ordered by Settings > Chat Options > Above chat.
  const nodes: Record<string, ReactElement | null> = {
    parent:
      parentAgentId && show("parent") ? (
        <ParentAgentPill serverId={serverId} parentAgentId={parentAgentId} />
      ) : null,
    tasks: show("tasks") ? <AgentTaskList tasks={tasks} /> : null,
    subagents: show("subagents") ? (
      <SubagentsTrack
        serverId={serverId}
        rows={subagentRows}
        onOpenSubagent={handleOpenSubagent}
        onOpenProviderSubagent={handleOpenProviderSubagent}
        sheetTabFor={sheetTabFor}
        onArchiveSubagent={archiveSubagent}
        onArchiveFinished={archiveFinishedSubagents.archiveFinished}
        archiveFinishedStatus={archiveFinishedSubagents.status}
        onDetachSubagent={canDetachSubagents ? detachSubagent : undefined}
      />
    ) : null,
    // CUSTOM(background-tools): live background shells and monitors, right of the subagents pill.
    "background-tools": show("background-tools") ? (
      <BackgroundToolsTrack serverId={serverId} agentId={agentId} tasks={backgroundTools} />
    ) : null,
    // CUSTOM(commit-wip): commits everything as "wip".
    commit: show("commit") ? (
      <CommitWipPill serverId={serverId} workspaceId={workspaceId} agentId={agentId} />
    ) : null,
    // CUSTOM(session-auto-rename): names the session from its status summary.
    rename: show("rename") ? <RenameSessionPill serverId={serverId} agentId={agentId} /> : null,
    diff: show("diff") ? (
      <WorkspaceDiffStatPill
        serverId={serverId}
        workspaceId={workspaceId}
        onPress={handleOpenChanges}
      />
    ) : null,
    // CUSTOM(worktree-pill): copies the worktree path or merges it into the main checkout.
    worktree:
      isDone || !show("worktree") ? null : (
        <WorktreePill
          serverId={serverId}
          workspaceId={workspaceId}
          agentId={agentId}
          cwd={cwd}
          gitSync={gitSync}
        />
      ),
    // CUSTOM(git-sync): "Trazer do <worktree>" or "Resolver conflitos".
    "git-sync": show("git-sync") ? (
      <GitSyncTrailingPills
        serverId={serverId}
        workspaceId={workspaceId}
        agentId={agentId}
        gitSync={gitSync}
      />
    ) : null,
    // CUSTOM(reading-modes): Columns and Compact.
    reading: show("reading") ? <ReadingModePill agentId={agentId} /> : null,
  };
  for (const { optionKey, entry } of pluginPills) {
    nodes[optionKey] = <PluginComposerPill serverId={serverId} entry={entry} compact={isCompact} />;
  }
  const orderedKeys = orderChatOptions(
    defaultAboveOrder(pluginPills.map(({ optionKey }) => optionKey)),
    orderSetting.above,
  ).filter((key) => nodes[key]);
  const { row: rowKeys, right: rightKeys } = layoutAboveRow(orderedKeys, isProjectManager);

  return (
    <ComposerTrackBar>
      {/* Upstream's Background work track; CUSTOM(background-tools) below keeps its own chip. */}
      <BackgroundWorkTrack model={backgroundModel} count={backgroundWorkCount} />
      {/* CUSTOM(worktree-pill-done): a done worktree session leads the row, whatever the order. */}
      {isDone && show("worktree") ? (
        <WorktreePill
          serverId={serverId}
          workspaceId={workspaceId}
          agentId={agentId}
          cwd={cwd}
          done
          merged={isMerged}
          gitSync={gitSync}
        />
      ) : null}
      {rowKeys.map((key) => (
        <Fragment key={key}>{nodes[key]}</Fragment>
      ))}
      {/* CUSTOM(assistant-restart-pill) */}
      {rightKeys.length > 0 ? (
        <View style={styles.rightGroup}>
          {rightKeys.map((key) => (
            <Fragment key={key}>{nodes[key]}</Fragment>
          ))}
        </View>
      ) : null}
    </ComposerTrackBar>
  );
});

// One branch per pill.
// eslint-disable-next-line complexity
export function hasAgentTracks({
  parentAgentId,
  subagentRows,
  tasks,
  archiveFinishedStatus,
  hasPluginComposerPills = false,
  options = {},
  hasBackgroundToolsRunning = false,
  hasBackgroundWork = false,
}: {
  parentAgentId: string | null;
  subagentRows: readonly SubagentRow[];
  tasks: readonly TodoEntry[] | undefined;
  archiveFinishedStatus: ArchiveFinishedStatus;
  hasPluginComposerPills?: boolean;
  options?: Record<string, boolean>;
  hasBackgroundToolsRunning?: boolean;
  /** Upstream's Background work track: the agent reports background work. */
  hasBackgroundWork?: boolean;
}): boolean {
  return (
    hasBackgroundWork ||
    // CUSTOM(commit-wip): Commit: wip shows with or without changes, so the row always does.
    (chatOptionEnabled(options, "commit") && COMMIT_WIP_PILL_ALWAYS_SHOWN) ||
    (chatOptionEnabled(options, "parent") && parentAgentId !== null) ||
    (chatOptionEnabled(options, "subagents") &&
      (subagentRows.length > 0 || archiveFinishedStatus.kind !== "idle")) ||
    (chatOptionEnabled(options, "background-tools") && hasBackgroundToolsRunning) ||
    (chatOptionEnabled(options, "tasks") && Boolean(tasks?.length)) ||
    chatOptionEnabled(options, "rename") ||
    chatOptionEnabled(options, "reading") ||
    chatOptionEnabled(options, "worktree") ||
    chatOptionEnabled(options, "git-sync") ||
    hasPluginComposerPills
  );
}

const styles = StyleSheet.create((theme) => ({
  // CUSTOM(assistant-restart-pill): same gap as the track bar; the reading pill's own
  // `marginLeft: "auto"` has no free space left inside this wrapper, so it stays inert.
  rightGroup: {
    flexDirection: "row",
    marginLeft: "auto",
    alignItems: "center",
    gap: theme.spacing[1],
  },
}));
