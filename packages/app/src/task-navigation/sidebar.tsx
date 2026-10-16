import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useShowShortcutBadges } from "@/hooks/use-show-shortcut-badges";
import { TaskProjectIcon, TaskProjectIconsProvider } from "./project-icon";
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { FlatList, Pressable, Text, View, type ListRenderItemInfo } from "react-native";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
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
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { activeDeskTab, useDesksStore, type TaskSort } from "./desks-store";
import { useMiddleClick } from "./use-middle-click";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { useSessionStore } from "@/stores/session-store";
import { useHosts } from "@/runtime/host-runtime";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useTaskNavigationStore } from "./store";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { TaskRowContextMenu, useTaskRowActions, type TaskRowActions } from "./task-row-menu";
import { useArchivedTasks } from "./use-archived-tasks";
import { useSettledTaskStates } from "./use-settled-task-states";
import {
  buildTaskTree,
  sortTaskTree,
  filterTaskTree,
  flattenTaskTree,
  limitIdleTasks,
  markableUnreadTaskKeys,
  matchesTaskFilter,
  taskKey,
  TASK_STATE_LABELS,
  type TaskAgent,
  type TaskFilter,
  type TaskNode,
} from "./model";

type ListRow =
  | { key: string; kind: "heading"; label: string; subheading?: boolean }
  | { key: string; kind: "task"; node: TaskNode; depth: number }
  | { key: string; kind: "idle-toggle"; hiddenCount: number }
  | { key: string; kind: "load-more"; loading: boolean };
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

// CUSTOM(task-navigation): unmount the inactive mode while preserving its independent preferences.
export function SidebarNavigationMode({
  children,
  onBeforeNavigate,
}: {
  children: ReactNode;
  onBeforeNavigate?: () => void;
}) {
  const enabled = useTaskNavigationStore((state) => state.enabled);
  return enabled ? (
    <TaskProjectIconsProvider>
      <TaskNavigationSidebar onBeforeNavigate={onBeforeNavigate} />
    </TaskProjectIconsProvider>
  ) : (
    children
  );
}

function rowKey(row: ListRow) {
  return row.key;
}

export function TaskNavigationSidebar({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const { allWorkspaceEntriesByKey, isInitialLoad } = useSidebarModel();
  const showBackground = useSidebarViewStore((state) => state.showBackground);
  const agents = useStoreWithEqualityFn(useSessionStore, selectAgents, equal);
  const hosts = useHosts();
  const [query, setQuery] = useState("");
  const projectKeys = useDesksStore((s) => s.projectKeys);
  const sort = useDesksStore((s) => s.sort);
  const setSort = useDesksStore((s) => s.setSort);
  const openedAt = useDesksStore((s) => s.openedAt);
  const pathname = usePathname();
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [idleExpanded, setIdleExpanded] = useState(false);
  const toggleIdle = useCallback(() => setIdleExpanded((value) => !value), []);
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
  const selectedAgentKey =
    deskTab?.target.kind === "agent" ? taskKey(deskTab.serverId, deskTab.target.agentId) : null;
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
  const rows = useMemo(() => {
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
    if (sort !== "attention")
      return flattenTaskTree(
        filtered,
        query || filter !== "all" || projectKeys !== null ? EMPTY_COLLAPSED : collapsed,
      ).map(
        (row): ListRow => ({ kind: "task", key: row.node.key, node: row.node, depth: row.depth }),
      );
    const result: ListRow[] = [];
    let attentionHeading = false;
    const groups = [
      { label: "Needs you", states: ["needs-you", "failed"], attention: true },
      { label: "Ready to review", states: ["review"], attention: true },
      { label: "In progress", states: ["working"], attention: false },
      { label: "Idle · ready to resume", states: ["idle", "closed"], attention: false },
    ];
    for (const group of groups) {
      let members = filtered.filter((node) => group.states.includes(node.crewState));
      if (!members.length) continue;
      // CUSTOM(task-idle-limit): searching or choosing the Idle filter shows every idle task.
      let hiddenCount = 0;
      if (group.states.includes("idle") && !query && filter !== "idle") {
        const limited = limitIdleTasks(members, { now: Date.now(), keepKey: selectedAgentKey });
        hiddenCount = limited.hiddenCount;
        if (!idleExpanded) members = limited.visible;
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
      if (hiddenCount > 0) result.push({ kind: "idle-toggle", key: "idle-toggle", hiddenCount });
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
    idleExpanded,
  ]);
  const openTask = useCallback(
    (node: TaskNode, pin = false) => {
      onBeforeNavigate?.();
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
      if (node) openTask(node);
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
            expanded={idleExpanded}
            onPress={toggleIdle}
            hiddenCount={item.hiddenCount}
            testID="task-idle-toggle"
          />
        );
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
          selected={selectedAgentKey === item.key}
          onOpen={openTask}
          onToggle={toggle}
          hostLabel={hosts.length > 1 ? hostNames.get(item.node.agent.serverId) : undefined}
          entry={entriesByWorkspace.get(
            taskKey(item.node.agent.serverId, item.node.workspace.workspaceId),
          )}
          archived={filter === "archived"}
          canMarkUnread={markableUnread.has(item.key)}
          actions={taskActions}
        />
      );
    },
    [
      idleExpanded,
      toggleIdle,
      loadMoreArchived,
      entriesByWorkspace,
      markableUnread,
      taskActions,
      shortcutNumbers,
      collapsed,
      query,
      filter,
      projectKeys,
      selectedAgentKey,
      openTask,
      toggle,
      hosts.length,
      hostNames,
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
      <View style={styles.header}>
        <Text style={styles.title}>Tasks & crews</Text>
      </View>
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
      <FlatList
        style={styles.list}
        data={rows}
        keyExtractor={rowKey}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        extraData={selectedAgentKey}
        ListEmptyComponent={emptyComponent}
      />
      {taskRenameModal}
    </View>
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
  actions,
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
  actions: TaskRowActions;
}) {
  const showBadges = useShowShortcutBadges();
  const age = useCompactTimeAgo(node.agent.updatedAt);
  const crossWorkspace = depth > 0;
  const handleOpen = useCallback(() => onOpen(node), [node, onOpen]);
  const pin = useCallback(() => onOpen(node, true), [node, onOpen]);
  const middleClickRef = useMiddleClick(pin);
  const handleToggle = useCallback(() => onToggle(node.key), [node.key, onToggle]);
  const expandedState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const selectedState = useMemo(() => ({ selected }), [selected]);
  const buttonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [styles.taskButton, hovered && styles.hovered],
    [],
  );
  const accessibilityLabel = `${node.agent.title ?? "Untitled agent"}, ${TASK_STATE_LABELS[node.state]}, ${node.workspace.projectName}, ${node.workspace.name}`;
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
        {node.workspace.projectName} · {node.workspace.name}
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
    <View
      style={[styles.task, selected && styles.selected, { marginLeft: Math.min(depth, 5) * 12 }]}
    >
      {node.children.length ? (
        <Pressable
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
        </Pressable>
      ) : (
        <View style={styles.railSpace} />
      )}
      {entry ? (
        <TaskRowContextMenu
          node={node}
          entry={entry}
          archived={archived}
          canMarkUnread={canMarkUnread}
          actions={actions}
          triggerRef={middleClickRef}
          style={buttonStyle}
          highlightStyle={styles.hovered}
          onPress={handleOpen}
          accessibilityRole="button"
          accessibilityState={selectedState}
          aria-selected={selected}
          accessibilityLabel={accessibilityLabel}
          testID={`task-agent-${node.agent.id}`}
        >
          {body}
        </TaskRowContextMenu>
      ) : (
        <Pressable
          ref={middleClickRef}
          style={buttonStyle}
          onPress={handleOpen}
          accessibilityRole="button"
          accessibilityState={selectedState}
          aria-selected={selected}
          accessibilityLabel={accessibilityLabel}
          testID={`task-agent-${node.agent.id}`}
        >
          {body}
        </Pressable>
      )}
    </View>
  );
});
const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  header: {
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
  reviewText: { color: theme.colors.statusDotRunning },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    backgroundColor: theme.colors.foregroundMuted,
  },
  workingDot: { backgroundColor: theme.colors.statusDotSuccess },
  inputDot: { backgroundColor: theme.colors.statusDotWarning },
  failedDot: { backgroundColor: theme.colors.statusDotDanger },
  reviewDot: { backgroundColor: theme.colors.statusDotRunning },
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
