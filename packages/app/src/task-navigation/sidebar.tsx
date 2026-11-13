import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useShowShortcutBadges } from "@/hooks/use-show-shortcut-badges";
import { TaskProjectIcon, TaskProjectIconsProvider } from "./project-icon";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Text, View, type ListRenderItemInfo } from "react-native";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { DensityIcon } from "@/components/ui/density-icon";
import { SearchField } from "@/components/ui/search-field";
import { SelectField, SelectFieldTrigger } from "@/components/ui/select-field";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { usePathname } from "expo-router";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { useIsCompactFormFactor } from "@/constants/layout";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { activeDeskTab, useDesksStore, type TaskSort } from "./desks-store";
import { useMiddleClick } from "./use-middle-click";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { useSessionStore } from "@/stores/session-store";
import { useHosts } from "@/runtime/host-runtime";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useTaskNavigationStore } from "./store";
// CUSTOM(task-provider-subagents): provider subagents under their agent in the Tasks list.
import { refreshProviderSubagents, useProviderSubagentStore } from "@/subagents/provider-store";
import {
  buildProviderSubagentRows,
  groupProviderSubagentsByParent,
  runningParentKeys,
  type ProviderSubagentListRow,
  type ProviderSubagentServerFlags,
} from "./provider-subagent-rows";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { TaskRowContextMenu, useTaskRowActions, type TaskRowActions } from "./task-row-menu";
import { useArchivedTasks } from "./use-archived-tasks";
import { useSettledTaskStates } from "./use-settled-task-states";
import { usePinnedTasksStore } from "./pinned-tasks-store";
import { TaskSummaryHoverCard } from "./task-summary-hover-card";
import {
  buildTaskTree,
  sortTaskTree,
  filterTaskTree,
  flattenTaskTree,
  IDLE_TASK_LIMIT,
  limitIdleTasks,
  markableUnreadTaskKeys,
  matchesTaskFilter,
  pinnedTaskNodes,
  taskKey,
  TASK_STATE_LABELS,
  type TaskAgent,
  type TaskFilter,
  type TaskNode,
} from "./model";

type ListRow =
  | { key: string; kind: "heading"; label: string; subheading?: boolean }
  | { key: string; kind: "task"; node: TaskNode; depth: number }
  | {
      key: string;
      kind: "idle-toggle";
      mode: IdleToggleMode;
      hiddenCount: number;
      onPress: () => void;
    }
  | { key: string; kind: "load-more"; loading: boolean }
  | ProviderSubagentListRow;
const FILTERS: readonly { key: TaskFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs-you", label: "Needs you" },
  { key: "review", label: "Ready to review" },
  { key: "working", label: "Working" },
  { key: "idle", label: "Idle" },
  // CUSTOM(task-archived-list): archived sessions load on demand when this filter is chosen.
  { key: "archived", label: "Archived" },
];
const EMPTY_COLLAPSED = new Set<string>();

type IdleToggleMode = "next" | "more" | "less";
const IDLE_CREW_STATES: readonly string[] = ["idle", "closed"];

/**
 * The row under the Idle group. "next" reveals a step, "more" shows the rest, and "less" folds back
 * to the opening limit. `idleShown` null means the group is still at its opening limit.
 */
function idleToggleRow(
  setIdleShown: (shown: number | null) => void,
  input: { hiddenCount: number; shown: number; idleShown: number | null },
): ListRow | null {
  const { hiddenCount, shown, idleShown } = input;
  if (hiddenCount === 0)
    return idleShown === null
      ? null
      : {
          kind: "idle-toggle",
          key: "idle-toggle",
          mode: "less",
          hiddenCount,
          onPress: () => setIdleShown(null),
        };
  if (idleShown === null)
    return {
      kind: "idle-toggle",
      key: "idle-toggle",
      mode: "next",
      hiddenCount,
      onPress: () => setIdleShown(shown + IDLE_TASK_LIMIT.step),
    };
  return {
    kind: "idle-toggle",
    key: "idle-toggle",
    mode: "more",
    hiddenCount,
    onPress: () => setIdleShown(Number.POSITIVE_INFINITY),
  };
}

/** One compact collection subscription; streamed messages never become task row props. */
function selectAgents(state: ReturnType<typeof useSessionStore.getState>): TaskAgent[] {
  const result: TaskAgent[] = [];
  for (const [serverId, session] of Object.entries(state.sessions)) {
    for (const agent of session.agents.values()) {
      if (agent.archivedAt) continue;
      result.push({
        serverId,
        id: agent.id,
        workspaceId: agent.workspaceId,
        title: agent.title,
        provider: agent.provider,
        model: agent.model,
        status: agent.status,
        running: agent.turn.phase === "open",
        pendingPermissionCount: agent.pendingPermissions.length,
        requiresAttention: agent.requiresAttention === true,
        attentionReason: agent.attentionReason,
        parentAgentId: agent.parentAgentId,
        updatedAt: agent.updatedAt,
      });
    }
  }
  return result;
}

// CUSTOM(task-provider-subagents): per-server feature flags, as one small comparable record.
function selectProviderSubagentFlags(
  state: ReturnType<typeof useSessionStore.getState>,
): Record<string, ProviderSubagentServerFlags> {
  const result: Record<string, ProviderSubagentServerFlags> = {};
  for (const [serverId, session] of Object.entries(state.sessions)) {
    result[serverId] = {
      supported: session.serverInfo?.features?.providerSubagents === true,
      nesting: session.serverInfo?.features?.providerSubagentNesting === true,
    };
  }
  return result;
}

// CUSTOM(task-navigation): unmount the inactive mode while preserving its independent preferences.
export function SidebarNavigationMode({
  children,
  onBeforeNavigate,
}: {
  children: ReactNode;
  onBeforeNavigate?: () => void;
}) {
  const enabled = useTaskNavigationStore((state) => state.enabled);
  const compactTasks = useTaskNavigationStore((state) => state.compactTasks);
  const compact = useIsCompactFormFactor();
  const tasks = (
    <TaskProjectIconsProvider>
      <TaskNavigationSidebar onBeforeNavigate={onBeforeNavigate} />
    </TaskProjectIconsProvider>
  );
  if (enabled) return tasks;
  if (!compact) return children;
  // CUSTOM(task-navigation-compact): the phone has no Tasks switch nor Desks. Its sidebar picks the
  // Tasks list or the Workspaces list, and a task opens in the ordinary workspace screen.
  return (
    <>
      <CompactSidebarModeSwitch />
      {compactTasks ? tasks : children}
    </>
  );
}

type CompactSidebarMode = "tasks" | "workspaces";
const COMPACT_SIDEBAR_MODES = [
  { value: "tasks", label: "Tasks", testID: "compact-sidebar-mode-tasks" },
  { value: "workspaces", label: "Workspaces", testID: "compact-sidebar-mode-workspaces" },
] satisfies { value: CompactSidebarMode; label: string; testID: string }[];

function CompactSidebarModeSwitch() {
  const compactTasks = useTaskNavigationStore((state) => state.compactTasks);
  const setCompactTasks = useTaskNavigationStore((state) => state.setCompactTasks);
  const onValueChange = useCallback(
    (mode: CompactSidebarMode) => setCompactTasks(mode === "tasks"),
    [setCompactTasks],
  );
  return (
    <SegmentedControl
      options={COMPACT_SIDEBAR_MODES}
      value={compactTasks ? "tasks" : "workspaces"}
      onValueChange={onValueChange}
      size="sm"
      style={styles.compactModeSwitch}
      testID="compact-sidebar-mode"
    />
  );
}

/** The agent focused in the open workspace, for the row highlight when Desks are off. */
function useWorkspaceFocusedAgentKey(enabled: boolean): string | null {
  const selection = useActiveWorkspaceSelection();
  return useWorkspaceLayoutStore((state) => {
    if (!enabled || !selection) return null;
    const layout = state.layoutByWorkspace[`${selection.serverId}:${selection.workspaceId}`];
    if (!layout) return null;
    const pane = findPaneById(layout.root, layout.focusedPaneId);
    const tab = collectAllTabs(layout.root).find((entry) => entry.tabId === pane?.focusedTabId);
    return tab?.target.kind === "agent" ? taskKey(selection.serverId, tab.target.agentId) : null;
  });
}

function rowKey(row: ListRow) {
  return row.key;
}

export function TaskNavigationSidebar({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const { allWorkspaceEntriesByKey, isInitialLoad } = useSidebarModel();
  const showBackground = useSidebarViewStore((state) => state.showBackground);
  const ownAgents = useStoreWithEqualityFn(useSessionStore, selectAgents, equal);
  // CUSTOM(task-provider-subagents): an agent whose provider subagent runs counts as working.
  const providerSubagentFlags = useStoreWithEqualityFn(
    useSessionStore,
    selectProviderSubagentFlags,
    equal,
  );
  const providerSubagents = useStoreWithEqualityFn(
    useProviderSubagentStore,
    (state) => groupProviderSubagentsByParent(state, providerSubagentFlags, taskKey),
    equal,
  );
  const runningParents = useMemo(() => runningParentKeys(providerSubagents), [providerSubagents]);
  const agents = useMemo(
    () =>
      runningParents.size === 0
        ? ownAgents
        : ownAgents.map((agent) =>
            !agent.running && runningParents.has(taskKey(agent.serverId, agent.id))
              ? { ...agent, running: true }
              : agent,
          ),
    [ownAgents, runningParents],
  );
  const [expandedSubagents, setExpandedSubagents] = useState<ReadonlySet<string>>(new Set());
  const toggleSubagents = useCallback(
    (key: string) =>
      setExpandedSubagents((current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  const hosts = useHosts();
  const [query, setQuery] = useState("");
  const projectKeys = useDesksStore((s) => s.projectKeys);
  const sort = useDesksStore((s) => s.sort);
  const setSort = useDesksStore((s) => s.setSort);
  const openedAt = useDesksStore((s) => s.openedAt);
  const pathname = usePathname();
  const [filter, setFilter] = useState<TaskFilter>("all");
  const filtersCollapsed = useTaskNavigationStore((state) => state.filtersCollapsed);
  const setFiltersCollapsed = useTaskNavigationStore((state) => state.setFiltersCollapsed);
  const toggleFilters = useCallback(
    () => setFiltersCollapsed(!filtersCollapsed),
    [filtersCollapsed, setFiltersCollapsed],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // Null is the opening limit. A number is how many idle roots show; Infinity shows them all.
  const [idleShown, setIdleShown] = useState<number | null>(null);
  const { actions: taskActions, modal: taskRenameModal } = useTaskRowActions();
  const markableUnread = useMemo(() => markableUnreadTaskKeys(agents), [agents]);
  const entriesByWorkspace = useMemo(
    () =>
      new Map(
        [...allWorkspaceEntriesByKey.values()].map((entry) => [
          taskKey(entry.serverId, entry.workspaceId),
          entry,
        ]),
      ),
    [allWorkspaceEntriesByKey],
  );
  const deskTab = useDesksStore(activeDeskTab);
  const desksEnabled = useTaskNavigationStore((state) => state.enabled);
  const workspaceAgentKey = useWorkspaceFocusedAgentKey(!desksEnabled);
  const deskAgentKey =
    deskTab?.target.kind === "agent" ? taskKey(deskTab.serverId, deskTab.target.agentId) : null;
  const selectedAgentKey = desksEnabled ? deskAgentKey : workspaceAgentKey;
  const workspaces = useMemo(
    () =>
      [...allWorkspaceEntriesByKey.values()]
        .filter((w) => showBackground || !w.background)
        .map((w) => ({
          serverId: w.serverId,
          workspaceId: w.workspaceId,
          projectKey: w.projectViewKey,
          projectName: w.projectName,
          name: w.title ?? w.name,
          directory: w.workspaceDirectory,
        })),
    [allWorkspaceEntriesByKey, showBackground],
  );
  const states = useSettledTaskStates(agents);
  const roots = useMemo(
    () => buildTaskTree({ agents, workspaces, states }),
    [agents, workspaces, states],
  );
  const archived = useArchivedTasks(filter === "archived", workspaces);
  // CUSTOM(task-pins): pinned sessions show under the filters whatever the search, project or filter.
  const pinnedKeys = usePinnedTasksStore((s) => s.keys);
  const pinnedSet = useMemo(() => new Set(pinnedKeys), [pinnedKeys]);
  const pinnedNodes = useMemo(() => pinnedTaskNodes(roots, pinnedKeys), [roots, pinnedKeys]);
  // The pinned task last opened from its pinned copy. Only the copy that was clicked highlights.
  const [openedFromPinned, setOpenedFromPinned] = useState<string | null>(null);
  const projects = useMemo(
    () =>
      [...new Map(workspaces.map((w) => [w.projectKey, w.projectName])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ id: value, value, label })),
    [workspaces],
  );
  const scopedRoots = useMemo(
    () => filterTaskTree(roots, { query, projectKeys, filter: "all" }),
    [roots, query, projectKeys],
  );
  const counts = useMemo(() => {
    const nodes = flattenTaskTree(scopedRoots)
      .map((row) => row.node)
      .filter((node) => !node.contextOnly);
    return Object.fromEntries(
      FILTERS.map((f) => [f.key, nodes.filter((n) => matchesTaskFilter(n.state, f.key)).length]),
    );
  }, [scopedRoots]);
  const archivedRoots = useMemo(
    () => filterTaskTree(archived.roots, { query, projectKeys, filter: "all" }),
    [archived.roots, query, projectKeys],
  );
  const archivedCount = archived.loaded ? archivedRoots.length : null;
  const [ordering, setOrdering] = useState(() => ({
    roots,
    sort,
    openedAt,
    tree: sortTaskTree(roots, sort, openedAt),
  }));
  let orderedTree = ordering.tree;
  if (ordering.roots !== roots || ordering.sort !== sort || ordering.openedAt !== openedAt) {
    orderedTree = sortTaskTree(roots, sort, openedAt, ordering.sort === sort ? ordering.tree : []);
    setOrdering({ roots, sort, openedAt, tree: orderedTree });
  }
  // CUSTOM(task-idle-limit): searching or choosing the Idle filter shows every idle task.
  const limitsIdle = !query && filter !== "idle";
  const taskRows = useMemo(() => {
    if (filter === "archived") {
      const result: ListRow[] = flattenTaskTree(archivedRoots, EMPTY_COLLAPSED).map((row) => ({
        kind: "task",
        key: row.node.key,
        node: row.node,
        depth: row.depth,
      }));
      if (archived.hasMore)
        result.push({ kind: "load-more", key: "load-more", loading: archived.isLoadingMore });
      return result;
    }
    const filtered = filterTaskTree(orderedTree, { query, projectKeys, filter });
    if (sort !== "attention") {
      // CUSTOM(task-idle-divider): the idle limit applies to every sort, not only "Your attention";
      // the divider's Expand / Collapse and the "Show next" row at the end page it.
      let visible = filtered;
      let toggle: ListRow | null = null;
      if (limitsIdle) {
        const idle = filtered.filter((node) => IDLE_CREW_STATES.includes(node.crewState));
        const limited = limitIdleTasks(idle, {
          now: Date.now(),
          keepKey: selectedAgentKey,
          shown: idleShown,
        });
        const shownIdle = new Set(limited.visible);
        visible = filtered.filter(
          (node) => !IDLE_CREW_STATES.includes(node.crewState) || shownIdle.has(node),
        );
        toggle = idleToggleRow(setIdleShown, { ...limited, idleShown });
      }
      const result = flattenTaskTree(
        visible,
        query || filter !== "all" || projectKeys !== null ? EMPTY_COLLAPSED : collapsed,
      ).map(
        (row): ListRow => ({ kind: "task", key: row.node.key, node: row.node, depth: row.depth }),
      );
      if (toggle) result.push(toggle);
      return result;
    }
    const result: ListRow[] = [];
    let attentionHeading = false;
    const groups = [
      { label: "Needs you", states: ["needs-you", "failed"], attention: true },
      { label: "Ready to review", states: ["review"], attention: true },
      { label: "In progress", states: ["working"], attention: false },
      { label: "Idle · ready to resume", states: IDLE_CREW_STATES, attention: false },
    ];
    for (const group of groups) {
      let members = filtered.filter((node) => group.states.includes(node.crewState));
      if (!members.length) continue;
      const idle = limitsIdle && group.states.includes("idle");
      let toggle: ListRow | null = null;
      if (idle) {
        const limited = limitIdleTasks(members, {
          now: Date.now(),
          keepKey: selectedAgentKey,
          shown: idleShown,
        });
        members = limited.visible;
        toggle = idleToggleRow(setIdleShown, { ...limited, idleShown });
      }
      if (group.attention && !attentionHeading) {
        result.push({ kind: "heading", key: "attention", label: "Your attention" });
        attentionHeading = true;
      }
      result.push({
        kind: "heading",
        key: group.label,
        label: group.label,
        subheading: group.attention,
      });
      for (const row of flattenTaskTree(
        members,
        query || filter !== "all" || projectKeys !== null ? EMPTY_COLLAPSED : collapsed,
      )) {
        result.push({ kind: "task", key: row.node.key, node: row.node, depth: row.depth });
      }
      if (toggle) result.push(toggle);
    }
    return result;
  }, [
    orderedTree,
    query,
    projectKeys,
    filter,
    collapsed,
    sort,
    archivedRoots,
    archived.hasMore,
    archived.isLoadingMore,
    selectedAgentKey,
    idleShown,
    limitsIdle,
  ]);
  // CUSTOM(task-provider-subagents): the toggle row (and the subagents when open) follows its
  // task row, ahead of the managed children. Archived sessions have none.
  const rows = useMemo(() => {
    if (filter === "archived" || providerSubagents.size === 0) return taskRows;
    return taskRows.flatMap((row): ListRow[] => {
      if (row.kind !== "task") return [row];
      return [
        row,
        ...buildProviderSubagentRows({
          node: row.node,
          depth: row.depth,
          subagents: providerSubagents.get(row.node.key),
          expanded: expandedSubagents.has(row.node.key),
        }),
      ];
    });
  }, [taskRows, filter, providerSubagents, expandedSubagents]);
  const openProviderSubagent = useCallback(
    (row: Extract<ListRow, { kind: "provider-subagent" }>) => {
      onBeforeNavigate?.();
      const target = {
        kind: "provider_subagent" as const,
        parentAgentId: row.parentAgentId,
        subagentId: row.subagentId,
      };
      if (!useTaskNavigationStore.getState().enabled) {
        navigateToWorkspace({
          serverId: row.serverId,
          workspaceId: row.workspaceId,
          target,
          pin: true,
        });
        return;
      }
      useDesksStore
        .getState()
        .openTab({ serverId: row.serverId, workspaceId: row.workspaceId, target }, true);
      if (!pathname.includes("/workspace/"))
        navigateToWorkspace({ serverId: row.serverId, workspaceId: row.workspaceId });
    },
    [onBeforeNavigate, pathname],
  );
  const openTask = useCallback(
    (node: TaskNode, pin = false) => {
      onBeforeNavigate?.();
      // CUSTOM(task-navigation-compact): without Desks the task opens as the workspace's agent tab.
      if (!useTaskNavigationStore.getState().enabled) {
        navigateToWorkspace({
          serverId: node.agent.serverId,
          workspaceId: node.workspace.workspaceId,
          target: { kind: "agent", agentId: node.agent.id },
          pin: true,
        });
        return;
      }
      useDesksStore.getState().openTab(
        {
          serverId: node.agent.serverId,
          workspaceId: node.workspace.workspaceId,
          target: { kind: "agent", agentId: node.agent.id },
        },
        pin,
      );
      if (!pathname.includes("/workspace/"))
        navigateToWorkspace({
          serverId: node.agent.serverId,
          workspaceId: node.workspace.workspaceId,
        });
    },
    [onBeforeNavigate, pathname],
  );
  const openListTask = useCallback(
    (node: TaskNode, pin = false) => {
      setOpenedFromPinned(null);
      openTask(node, pin);
    },
    [openTask],
  );
  const openPinnedTask = useCallback(
    (node: TaskNode, pin = false) => {
      setOpenedFromPinned(node.key);
      openTask(node, pin);
    },
    [openTask],
  );
  const selectedKeyInPinned =
    selectedAgentKey !== null &&
    selectedAgentKey === openedFromPinned &&
    pinnedSet.has(selectedAgentKey)
      ? selectedAgentKey
      : null;
  const selectedKeyInList = selectedKeyInPinned === null ? selectedAgentKey : null;
  const shortcutTasks = useMemo(
    () => rows.flatMap((row) => (row.kind === "task" ? [row.node] : [])).slice(0, 9),
    [rows],
  );
  const shortcutNumbers = useMemo(
    () => new Map(shortcutTasks.map((node, index) => [node.key, index + 1])),
    [shortcutTasks],
  );
  useKeyboardActionHandler({
    handlerId: "task-sidebar-jump",
    actions: ["task.navigate.index"],
    enabled: true,
    priority: 200,
    handle: (action) => {
      if (action.id !== "task.navigate.index") return false;
      const node = shortcutTasks[action.index - 1];
      if (node) openListTask(node);
      return true;
    },
  });
  const toggle = useCallback(
    (key: string) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  const hostNames = useMemo(
    () => new Map(hosts.map((host) => [host.serverId, host.label])),
    [hosts],
  );
  const loadMoreArchived = archived.loadMore;
  const renderRow = useCallback(
    ({ item }: ListRenderItemInfo<ListRow>) => {
      if (item.kind === "heading")
        return (
          <Text style={item.subheading ? styles.subheading : styles.heading}>{item.label}</Text>
        );
      if (item.kind === "idle-toggle")
        return (
          <SidebarGroupToggleRow
            expanded={item.mode === "less"}
            onPress={item.onPress}
            hiddenCount={item.hiddenCount}
            label={
              item.mode === "next"
                ? `Show next ${Math.min(IDLE_TASK_LIMIT.step, item.hiddenCount)}`
                : undefined
            }
            testID="task-idle-toggle"
          />
        );
      if (item.kind === "provider-subagents-toggle")
        return <ProviderSubagentsToggleRow row={item} onToggle={toggleSubagents} />;
      if (item.kind === "provider-subagent")
        return <ProviderSubagentItemRow row={item} onOpen={openProviderSubagent} />;
      if (item.kind === "load-more")
        return (
          <Button
            variant="ghost"
            size="xs"
            onPress={loadMoreArchived}
            disabled={item.loading}
            testID="task-archived-load-more"
          >
            {item.loading ? "Loading…" : "Load more"}
          </Button>
        );
      return (
        <TaskRow
          node={item.node}
          depth={item.depth}
          shortcutNumber={shortcutNumbers.get(item.key)}
          collapsed={collapsed.has(item.key) && !query && filter === "all" && projectKeys === null}
          selected={selectedKeyInList === item.key}
          onOpen={openListTask}
          onToggle={toggle}
          hostLabel={hosts.length > 1 ? hostNames.get(item.node.agent.serverId) : undefined}
          entry={entriesByWorkspace.get(
            taskKey(item.node.agent.serverId, item.node.workspace.workspaceId),
          )}
          archived={filter === "archived"}
          canMarkUnread={markableUnread.has(item.key)}
          pinned={pinnedSet.has(item.key)}
          actions={taskActions}
        />
      );
    },
    [
      toggleSubagents,
      openProviderSubagent,
      loadMoreArchived,
      pinnedSet,
      entriesByWorkspace,
      markableUnread,
      taskActions,
      shortcutNumbers,
      collapsed,
      query,
      filter,
      projectKeys,
      selectedKeyInList,
      openListTask,
      toggle,
      hosts.length,
      hostNames,
    ],
  );
  const pinnedHeader = useMemo(
    () =>
      pinnedNodes.length ? (
        <View style={styles.pinned} testID="task-pinned">
          {pinnedNodes.map((node) => (
            <TaskRow
              key={node.key}
              node={node}
              depth={0}
              collapsed={false}
              selected={selectedKeyInPinned === node.key}
              onOpen={openPinnedTask}
              onToggle={toggle}
              hostLabel={hosts.length > 1 ? hostNames.get(node.agent.serverId) : undefined}
              entry={entriesByWorkspace.get(
                taskKey(node.agent.serverId, node.workspace.workspaceId),
              )}
              archived={false}
              canMarkUnread={markableUnread.has(node.key)}
              pinned
              actions={taskActions}
              testIDPrefix="task-pinned"
            />
          ))}
        </View>
      ) : null,
    [
      pinnedNodes,
      selectedKeyInPinned,
      openPinnedTask,
      toggle,
      hosts.length,
      hostNames,
      entriesByWorkspace,
      markableUnread,
      taskActions,
    ],
  );
  const emptyComponent = useMemo(
    () => (
      <Text style={styles.empty}>
        {isInitialLoad || (filter === "archived" && !archived.loaded)
          ? "Loading tasks…"
          : "No matching tasks. Adjust your search or project selection."}
      </Text>
    ),
    [isInitialLoad, filter, archived.loaded],
  );
  return (
    <View style={styles.container} testID="task-navigation-sidebar">
      <TaskFiltersToggle collapsed={filtersCollapsed} onToggle={toggleFilters} />
      {filtersCollapsed ? null : (
        <View style={styles.controls}>
          <View style={styles.searchRow}>
            <View style={styles.search}>
              <SearchField
                value={query}
                onChangeText={setQuery}
                placeholder="Search tasks…"
                clearAccessibilityLabel="Clear task search"
                testID="task-navigation-search"
              />
            </View>
            <ProjectPicker projects={projects} selected={projectKeys} />
          </View>
          <SelectField
            field={false}
            label="Sort tasks"
            placeholder="Sort tasks"
            emptyText="No sort options"
            value={sort}
            selectedDisplay={SORT_OPTIONS.find((s) => s.value === sort) ?? null}
            options={SORT_OPTIONS}
            onChange={setSort}
            size="sm"
            triggerTestID="task-navigation-sort"
          />
          <View style={styles.filters}>
            {FILTERS.map((f) => (
              <TaskFilterButton
                key={f.key}
                entry={f}
                count={f.key === "archived" ? archivedCount : (counts[f.key] ?? 0)}
                selected={filter === f.key}
                onSelect={setFilter}
              />
            ))}
          </View>
        </View>
      )}
      <FlatList
        style={styles.list}
        data={rows}
        keyExtractor={rowKey}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        extraData={selectedKeyInList}
        ListHeaderComponent={
          <>
            {pinnedHeader}
            <TaskListDivider
              rows={rows}
              afterPinned={pinnedNodes.length > 0}
              setIdleShown={setIdleShown}
            />
          </>
        }
        ListEmptyComponent={emptyComponent}
      />
      {taskRenameModal}
    </View>
  );
}

// CUSTOM(task-idle-divider): the line under the pinned tasks reads "Expand N ———" or "Collapse ———"
// for the idle tasks the list holds back, so folding them away never means scrolling to the end.
function TaskListDivider({
  rows,
  afterPinned,
  setIdleShown,
}: {
  rows: readonly ListRow[];
  afterPinned: boolean;
  setIdleShown(shown: number | null): void;
}) {
  const toggle = rows.find((row) => row.kind === "idle-toggle");
  const expanded = toggle?.kind === "idle-toggle" && toggle.mode === "less";
  const hiddenCount = toggle?.kind === "idle-toggle" ? toggle.hiddenCount : 0;
  const onPress = useCallback(
    () => setIdleShown(expanded ? null : Number.POSITIVE_INFINITY),
    [expanded, setIdleShown],
  );
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  if (!toggle) return afterPinned ? <View style={styles.dividerLine} /> : null;
  return (
    <View style={styles.dividerRow}>
      <PressHighlight
        style={styles.dividerButton}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Collapse idle tasks" : "Expand idle tasks"}
        accessibilityState={accessibilityState}
        testID="task-idle-divider-toggle"
      >
        <DensityIcon icon={expanded ? ChevronUp : ChevronDown} size="sm" color="foregroundMuted" />
        <Text style={styles.dividerLabel}>{expanded ? "Collapse" : `Expand ${hiddenCount}`}</Text>
      </PressHighlight>
      <View style={styles.dividerFill} />
    </View>
  );
}

// CUSTOM(task-filters-toggle): the header's arrow folds the controls away so the list gets the
// room, which matters most in the phone sidebar.
function TaskFiltersToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle(): void }) {
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  return (
    <PressHighlight
      style={styles.header}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={collapsed ? "Show task filters" : "Hide task filters"}
      accessibilityState={accessibilityState}
      testID="task-navigation-filters-toggle"
    >
      <Text style={styles.title}>Tasks & crews</Text>
      <DensityIcon
        icon={collapsed ? ChevronRight : ChevronDown}
        size="sm"
        color="foregroundMuted"
      />
    </PressHighlight>
  );
}

function TaskFilterButton({
  entry,
  count,
  selected,
  onSelect,
}: {
  entry: (typeof FILTERS)[number];
  /** Null while the count is unknown (archived sessions not loaded yet). */
  count: number | null;
  selected: boolean;
  onSelect(filter: TaskFilter): void;
}) {
  const select = useCallback(() => onSelect(entry.key), [entry.key, onSelect]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Button
      variant={selected ? "secondary" : "ghost"}
      size="xs"
      onPress={select}
      accessibilityLabel={count === null ? entry.label : `${entry.label}, ${count} tasks`}
      accessibilityState={accessibilityState}
      testID={`task-filter-${entry.key}`}
    >
      {count === null ? entry.label : `${entry.label} ${count}`}
    </Button>
  );
}
function TaskSignal({ state }: { state: TaskNode["state"] }) {
  return (
    <View
      style={[
        styles.dot,
        state === "working" && styles.workingDot,
        state === "needs-you" && styles.inputDot,
        state === "failed" && styles.failedDot,
        state === "review" && styles.reviewDot,
      ]}
    />
  );
}
function TaskStateLabel({ state }: { state: TaskNode["state"] }) {
  if (state !== "review" && state !== "failed" && state !== "needs-you") return null;
  return (
    <Text
      style={[
        styles.stateLabel,
        state === "review" && styles.reviewText,
        state === "failed" && styles.failedText,
      ]}
    >
      {TASK_STATE_LABELS[state]}
    </Text>
  );
}

// CUSTOM(task-double-click): how long a click's Desks snapshot can still be undone by a double click.
const DOUBLE_CLICK_MS = 1000;
type DesksBeforeClick = { at: number } & Pick<
  ReturnType<typeof useDesksStore.getState>,
  "desks" | "activeDeskId"
>;
const TaskRow = memo(function TaskRow({
  shortcutNumber,
  node,
  depth,
  selected,
  collapsed,
  onOpen,
  onToggle,
  hostLabel,
  entry,
  archived,
  canMarkUnread,
  pinned,
  actions,
  testIDPrefix = "task-agent",
}: {
  node: TaskNode;
  shortcutNumber?: number;
  depth: number;
  selected: boolean;
  collapsed: boolean;
  onOpen(node: TaskNode, pin?: boolean): void;
  onToggle(key: string): void;
  hostLabel?: string;
  entry: SidebarWorkspaceEntry | undefined;
  archived: boolean;
  canMarkUnread: boolean;
  pinned: boolean;
  actions: TaskRowActions;
  /** Pinned copies use their own test ids so the original row stays unique. */
  testIDPrefix?: string;
}) {
  useRefreshProviderSubagentsOnce(node.agent.serverId, node.agent.id);
  const showBadges = useShowShortcutBadges();
  const age = useCompactTimeAgo(node.agent.updatedAt);
  const crossWorkspace = depth > 0;
  // CUSTOM(task-double-click): a double click opens the task in a new tab. Its first click already
  // turned the preview tab into this task, so the double click puts the Desks back first.
  const beforeClick = useRef<DesksBeforeClick | null>(null);
  const handleOpen = useCallback(() => {
    const last = beforeClick.current;
    if (!last || Date.now() - last.at > DOUBLE_CLICK_MS) {
      const { desks, activeDeskId } = useDesksStore.getState();
      beforeClick.current = { at: Date.now(), desks, activeDeskId };
    }
    onOpen(node);
  }, [node, onOpen]);
  const openInNewTab = useCallback(() => {
    const before = beforeClick.current;
    beforeClick.current = null;
    if (before && Date.now() - before.at <= DOUBLE_CLICK_MS) {
      useDesksStore.setState({ desks: before.desks, activeDeskId: before.activeDeskId });
    }
    onOpen(node, true);
  }, [node, onOpen]);
  const pin = useCallback(() => onOpen(node, true), [node, onOpen]);
  const middleClickRef = useMiddleClick(pin, openInNewTab);
  const handleToggle = useCallback(() => onToggle(node.key), [node.key, onToggle]);
  const expandedState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const selectedState = useMemo(() => ({ selected }), [selected]);
  const buttonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [styles.taskButton, hovered && styles.hovered],
    [],
  );
  const accessibilityLabel = `${node.agent.title ?? "Untitled agent"}, ${TASK_STATE_LABELS[node.state]}, ${node.workspace.projectName}`;
  const body = (
    <>
      <View style={styles.taskTop}>
        <TaskSignal state={node.state} />
        <TaskProjectIcon serverId={node.agent.serverId} workspaceId={node.workspace.workspaceId} />
        <Text numberOfLines={2} style={[styles.taskTitle, node.contextOnly && styles.contextTitle]}>
          {node.agent.title ?? "Untitled agent"}
        </Text>
        {showBadges && shortcutNumber ? (
          <Text style={styles.shortcutBadge} testID={`task-shortcut-${shortcutNumber}`}>
            {shortcutNumber}
          </Text>
        ) : (
          <Text style={styles.age}>{age}</Text>
        )}
      </View>
      <Text numberOfLines={1} style={styles.metadata}>
        {node.workspace.projectName}
        {hostLabel ? ` · ${hostLabel}` : ""}
      </Text>
      <TaskStateLabel state={node.state} />
      {node.children.length || crossWorkspace ? (
        <Text numberOfLines={1} style={styles.metadata}>
          {node.children.length
            ? `${node.children.length} delegated ${node.children.length === 1 ? "task" : "tasks"}`
            : `↳ ${node.workspace.name}`}
        </Text>
      ) : null}
    </>
  );
  return (
    // CUSTOM(task-summary-hover): hovering the row shows the agent's status summary.
    <TaskSummaryHoverCard serverId={node.agent.serverId} agentId={node.agent.id}>
      <View
        style={[styles.task, selected && styles.selected, { marginLeft: Math.min(depth, 5) * 12 }]}
      >
        {node.children.length ? (
          <PressHighlight
            style={styles.expand}
            onPress={handleToggle}
            accessibilityRole="button"
            accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${node.agent.title ?? "crew"}`}
            accessibilityState={expandedState}
            testID={`task-expand-${node.agent.id}`}
          >
            <DensityIcon
              icon={collapsed ? ChevronRight : ChevronDown}
              size="sm"
              color="foregroundMuted"
            />
          </PressHighlight>
        ) : (
          <View style={styles.railSpace} />
        )}
        {entry ? (
          <TaskRowContextMenu
            node={node}
            entry={entry}
            archived={archived}
            canMarkUnread={canMarkUnread}
            pinned={pinned}
            actions={actions}
            triggerRef={middleClickRef}
            style={buttonStyle}
            highlightStyle={styles.hovered}
            onPress={handleOpen}
            accessibilityRole="button"
            accessibilityState={selectedState}
            aria-selected={selected}
            accessibilityLabel={accessibilityLabel}
            testID={`${testIDPrefix}-${node.agent.id}`}
          >
            {body}
          </TaskRowContextMenu>
        ) : (
          <PressHighlight
            ref={middleClickRef}
            style={buttonStyle}
            onPress={handleOpen}
            accessibilityRole="button"
            accessibilityState={selectedState}
            aria-selected={selected}
            accessibilityLabel={accessibilityLabel}
            testID={`${testIDPrefix}-${node.agent.id}`}
          >
            {body}
          </PressHighlight>
        )}
      </View>
    </TaskSummaryHoverCard>
  );
});
// CUSTOM(task-provider-subagents): list each (server, agent) once per app session, from rows that
// are mounted, so subagents started before the app connected show up without listing every agent.
const refreshedProviderSubagentParents = new Set<string>();
function useRefreshProviderSubagentsOnce(serverId: string, agentId: string) {
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  useEffect(() => {
    if (!client || !supported) return;
    const key = taskKey(serverId, agentId);
    if (refreshedProviderSubagentParents.has(key)) return;
    refreshedProviderSubagentParents.add(key);
    if (useProviderSubagentStore.getState().trackedParents.has(`${serverId}\0${agentId}\0`)) return;
    void refreshProviderSubagents(client, serverId, agentId).catch(() => {
      refreshedProviderSubagentParents.delete(key);
    });
  }, [client, supported, serverId, agentId]);
}

function ProviderSubagentsToggleRow({
  row,
  onToggle,
}: {
  row: Extract<ListRow, { kind: "provider-subagents-toggle" }>;
  onToggle(key: string): void;
}) {
  const press = useCallback(() => onToggle(row.parentKey), [onToggle, row.parentKey]);
  const expandedState = useMemo(() => ({ expanded: row.expanded }), [row.expanded]);
  const buttonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [styles.subagentButton, hovered && styles.hovered],
    [],
  );
  return (
    <View style={[styles.subagentRow, { marginLeft: Math.min(row.depth, 5) * 12 }]}>
      <PressHighlight
        style={buttonStyle}
        onPress={press}
        accessibilityRole="button"
        accessibilityLabel={`${row.expanded ? "Collapse" : "Expand"} ${row.label}`}
        accessibilityState={expandedState}
        testID={`task-subagents-toggle-${row.parentKey}`}
      >
        <DensityIcon
          icon={row.expanded ? ChevronDown : ChevronRight}
          size="sm"
          color="foregroundMuted"
        />
        <Text numberOfLines={1} style={styles.subagentLabel}>
          {row.label}
        </Text>
      </PressHighlight>
    </View>
  );
}

function ProviderSubagentItemRow({
  row,
  onOpen,
}: {
  row: Extract<ListRow, { kind: "provider-subagent" }>;
  onOpen(row: Extract<ListRow, { kind: "provider-subagent" }>): void;
}) {
  const press = useCallback(() => onOpen(row), [onOpen, row]);
  const buttonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [styles.subagentButton, hovered && styles.hovered],
    [],
  );
  let state: TaskNode["state"] = "idle";
  if (row.bucket === "running") state = "working";
  if (row.bucket === "failed") state = "failed";
  return (
    <View style={[styles.subagentRow, { marginLeft: Math.min(row.depth, 5) * 12 }]}>
      <PressHighlight
        style={buttonStyle}
        onPress={press}
        accessibilityRole="button"
        accessibilityLabel={`${row.label || "Subagent"}, ${TASK_STATE_LABELS[state]}`}
        testID={`task-subagent-${row.subagentId}`}
      >
        <View style={styles.subagentDot}>
          <TaskSignal state={state} />
        </View>
        <View style={styles.subagentText}>
          <Text numberOfLines={1} style={styles.subagentTitle}>
            {row.label || "Subagent"}
          </Text>
          {row.subtitle ? (
            <Text numberOfLines={1} style={styles.subagentMeta}>
              {row.subtitle}
            </Text>
          ) : null}
        </View>
      </PressHighlight>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  compactModeSwitch: {
    marginHorizontal: theme.spacing[3],
    marginTop: theme.spacing[2],
    alignSelf: "stretch",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  controls: { padding: theme.spacing[2], gap: theme.spacing[2] },
  searchRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  search: { flex: 1, minWidth: 0, flexDirection: "row" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1] },
  list: { flex: 1, paddingHorizontal: theme.spacing[2] },
  pinned: { paddingBottom: theme.spacing[1] },
  // CUSTOM(task-idle-divider)
  dividerLine: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginBottom: theme.spacing[1],
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[1],
  },
  dividerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
  dividerLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  dividerFill: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  heading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  subheading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  task: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing[1],
  },
  selected: { backgroundColor: theme.colors.surface3 },
  expand: { width: 20, alignItems: "center", paddingTop: theme.spacing[2] },
  railSpace: { width: 20 },
  taskButton: {
    flex: 1,
    minWidth: 0,
    paddingVertical: theme.spacing[2],
    paddingRight: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  hovered: { backgroundColor: theme.colors.surface2 },
  // CUSTOM(task-provider-subagents)
  subagentRow: { flexDirection: "row", marginBottom: theme.spacing[1] },
  subagentButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[1],
    paddingRight: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  subagentLabel: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  subagentDot: { paddingTop: 1 },
  subagentText: { flex: 1, minWidth: 0 },
  subagentTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  subagentMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  taskTop: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[2] },
  taskTitle: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  contextTitle: { color: theme.colors.foregroundMuted },
  shortcutBadge: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    fontSize: theme.fontSize.sm,
  },
  age: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  metadata: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: 14,
    marginTop: theme.spacing[1],
  },
  stateLabel: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
    marginLeft: 14,
    marginTop: theme.spacing[1],
  },
  failedText: { color: theme.colors.statusDanger },
  reviewText: { color: theme.colors.statusDotSuccess },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    backgroundColor: theme.colors.foregroundMuted,
  },
  workingDot: { backgroundColor: theme.colors.statusDotRunning },
  inputDot: { backgroundColor: theme.colors.statusDotWarning },
  failedDot: { backgroundColor: theme.colors.statusDotDanger },
  reviewDot: { backgroundColor: theme.colors.statusDotSuccess },
  footer: { borderTopWidth: 1, borderColor: theme.colors.border, padding: theme.spacing[2] },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
}));

const SORT_OPTIONS: { id: TaskSort; value: TaskSort; label: string }[] = [
  { id: "attention", value: "attention", label: "Attention first" },
  { id: "activity", value: "activity", label: "Last activity" },
  { id: "opened", value: "opened", label: "Recently opened" },
  { id: "title", value: "title", label: "Title A–Z" },
];
function ProjectPicker({
  projects,
  selected,
}: {
  projects: { value: string; label: string }[];
  selected: string[] | null;
}) {
  const all = useCallback(() => useDesksStore.getState().setProjects(null), []);
  const none = useCallback(() => useDesksStore.getState().setProjects([]), []);
  const keys = useMemo(() => projects.map((p) => p.value), [projects]);
  const count =
    selected === null ? projects.length : projects.filter((p) => selected.includes(p.value)).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger testID="task-navigation-project">
        <SelectFieldTrigger label={`Projects ${count}`} placeholder="Projects" size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={all} closeOnSelect={false}>
          Select all
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={none} closeOnSelect={false}>
          Select none
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {projects.map((p) => (
          <ProjectChoice
            key={p.value}
            value={p.value}
            label={p.label}
            selected={selected === null || selected.includes(p.value)}
            keys={keys}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function ProjectChoice({
  value,
  label,
  selected,
  keys,
}: {
  value: string;
  label: string;
  selected: boolean;
  keys: string[];
}) {
  const toggle = useCallback(() => {
    const store = useDesksStore.getState();
    const current = store.projectKeys ?? keys;
    store.setProjects(
      current.includes(value) ? current.filter((k) => k !== value) : [...current, value],
    );
  }, [value, keys]);
  return (
    <DropdownMenuItem selected={selected} showSelectedCheck closeOnSelect={false} onSelect={toggle}>
      {label}
    </DropdownMenuItem>
  );
}
