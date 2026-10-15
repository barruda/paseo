import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { FlatList, Pressable, Text, View, type ListRenderItemInfo } from "react-native";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { ChevronDown, ChevronRight, Folder } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { DensityIcon } from "@/components/ui/density-icon";
import { SearchField } from "@/components/ui/search-field";
import { SelectField } from "@/components/ui/select-field";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { SidebarWorkspacesNewWorkspaceRow } from "@/components/sidebar/sidebar-nav-rows";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { useSessionStore } from "@/stores/session-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useHosts } from "@/runtime/host-runtime";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useTaskNavigationStore } from "./store";
import {
  buildTaskTree,
  filterTaskTree,
  flattenTaskTree,
  matchesTaskFilter,
  taskKey,
  TASK_STATE_LABELS,
  type TaskAgent,
  type TaskFilter,
  type TaskNode,
} from "./model";

type ListRow =
  | { key: string; kind: "heading"; label: string; subheading?: boolean }
  | { key: string; kind: "task"; node: TaskNode; depth: number };
const FILTERS: readonly { key: TaskFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs-you", label: "Needs you" },
  { key: "review", label: "Ready to review" },
  { key: "working", label: "Working" },
  { key: "idle", label: "Idle" },
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
  return enabled ? <TaskNavigationSidebar onBeforeNavigate={onBeforeNavigate} /> : children;
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
  const [projectKey, setProjectKey] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const setEnabled = useTaskNavigationStore((state) => state.setEnabled);
  const active = useActiveWorkspaceSelection();
  const activeKey = active ? taskKey(active.serverId, active.workspaceId) : null;
  const selectedAgentKey = useWorkspaceLayoutStore((state) => {
    const layout = activeKey ? state.layoutByWorkspace[activeKey] : null;
    const pane = layout ? findPaneById(layout.root, layout.focusedPaneId) : null;
    const target = layout
      ? collectAllTabs(layout.root).find((tab) => tab.tabId === pane?.focusedTabId)?.target
      : undefined;
    return active && target?.kind === "agent" ? taskKey(active.serverId, target.agentId) : null;
  });
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
  const roots = useMemo(() => buildTaskTree({ agents, workspaces }), [agents, workspaces]);
  const projects = useMemo(
    () =>
      [...new Map(workspaces.map((w) => [w.projectKey, w.projectName])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ id: value, value, label })),
    [workspaces],
  );
  // A removed or externally filtered project must not leave an invisible, un-clearable selection.
  const effectiveProjectKey = projects.some((p) => p.value === projectKey) ? projectKey : "";
  const projectOptions = useMemo(
    () => [{ id: "all", value: "", label: "All projects" }, ...projects],
    [projects],
  );
  const scopedRoots = useMemo(
    () => filterTaskTree(roots, { query, projectKey: effectiveProjectKey, filter: "all" }),
    [roots, query, effectiveProjectKey],
  );
  const counts = useMemo(() => {
    const nodes = flattenTaskTree(scopedRoots)
      .map((row) => row.node)
      .filter((node) => !node.contextOnly);
    return Object.fromEntries(
      FILTERS.map((f) => [f.key, nodes.filter((n) => matchesTaskFilter(n.state, f.key)).length]),
    );
  }, [scopedRoots]);
  const rows = useMemo(() => {
    const filtered = filterTaskTree(roots, { query, projectKey: effectiveProjectKey, filter });
    const result: ListRow[] = [];
    let attentionHeading = false;
    const groups = [
      { label: "Needs you", states: ["needs-you", "failed"], attention: true },
      { label: "Ready to review", states: ["review"], attention: true },
      { label: "In progress", states: ["working"], attention: false },
      { label: "Idle · ready to resume", states: ["idle", "closed"], attention: false },
    ];
    for (const group of groups) {
      const members = filtered.filter((node) => group.states.includes(node.crewState));
      if (!members.length) continue;
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
        query || filter !== "all" || effectiveProjectKey ? EMPTY_COLLAPSED : collapsed,
      )) {
        result.push({ kind: "task", key: row.node.key, ...row });
      }
    }
    return result;
  }, [roots, query, effectiveProjectKey, filter, collapsed]);
  const openTask = useCallback(
    (node: TaskNode) => {
      onBeforeNavigate?.();
      navigateToAgent({
        serverId: node.agent.serverId,
        agentId: node.agent.id,
        workspaceId: node.agent.workspaceId,
        pin: true,
      });
    },
    [onBeforeNavigate],
  );
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
  const renderRow = useCallback(
    ({ item }: ListRenderItemInfo<ListRow>) =>
      item.kind === "heading" ? (
        <Text style={item.subheading ? styles.subheading : styles.heading}>{item.label}</Text>
      ) : (
        <TaskRow
          node={item.node}
          depth={item.depth}
          collapsed={collapsed.has(item.key) && !query && filter === "all" && !effectiveProjectKey}
          selected={selectedAgentKey === item.key}
          onOpen={openTask}
          onToggle={toggle}
          hostLabel={hosts.length > 1 ? hostNames.get(item.node.agent.serverId) : undefined}
        />
      ),
    [
      collapsed,
      query,
      filter,
      effectiveProjectKey,
      selectedAgentKey,
      openTask,
      toggle,
      hosts.length,
      hostNames,
    ],
  );
  const browseWorkspaces = useCallback(() => setEnabled(false), [setEnabled]);
  const emptyComponent = useMemo(
    () => (
      <Text style={styles.empty}>
        {isInitialLoad
          ? "Loading tasks…"
          : "No matching tasks. Try another search or browse workspaces."}
      </Text>
    ),
    [isInitialLoad],
  );
  return (
    <View style={styles.container} testID="task-navigation-sidebar">
      <View style={styles.header}>
        <Text style={styles.title}>Tasks & crews</Text>
      </View>
      <SidebarWorkspacesNewWorkspaceRow onBeforeNavigate={onBeforeNavigate} />
      <View style={styles.controls}>
        <View style={styles.search}>
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search tasks, workspaces…"
            clearAccessibilityLabel="Clear task search"
            testID="task-navigation-search"
          />
        </View>
        <SelectField
          field={false}
          label="Project"
          value={effectiveProjectKey}
          selectedDisplay={projectOptions.find((p) => p.value === effectiveProjectKey) ?? null}
          options={projectOptions}
          onChange={setProjectKey}
          placeholder="All projects"
          emptyText="No projects"
          searchable
          searchPlaceholder="Find a project…"
          size="sm"
          triggerTestID="task-navigation-project"
        />
        <View style={styles.filters}>
          {FILTERS.map((f) => (
            <TaskFilterButton
              key={f.key}
              entry={f}
              count={counts[f.key] ?? 0}
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
      <View style={styles.footer}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Folder}
          onPress={browseWorkspaces}
          testID="task-navigation-browse-workspaces"
        >
          Browse workspaces
        </Button>
      </View>
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
  count: number;
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
      accessibilityLabel={`${entry.label}, ${count} tasks`}
      accessibilityState={accessibilityState}
      testID={`task-filter-${entry.key}`}
    >
      {entry.label} {count}
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
  node,
  depth,
  selected,
  collapsed,
  onOpen,
  onToggle,
  hostLabel,
}: {
  node: TaskNode;
  depth: number;
  selected: boolean;
  collapsed: boolean;
  onOpen(node: TaskNode): void;
  onToggle(key: string): void;
  hostLabel?: string;
}) {
  const age = useCompactTimeAgo(node.agent.updatedAt);
  const crossWorkspace = depth > 0;
  const handleOpen = useCallback(() => onOpen(node), [node, onOpen]);
  const handleToggle = useCallback(() => onToggle(node.key), [node.key, onToggle]);
  const expandedState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const selectedState = useMemo(() => ({ selected }), [selected]);
  const buttonStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [styles.taskButton, hovered && styles.hovered],
    [],
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
      <Pressable
        style={buttonStyle}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityState={selectedState}
        aria-selected={selected}
        accessibilityLabel={`${node.agent.title ?? "Untitled agent"}, ${TASK_STATE_LABELS[node.state]}, ${node.workspace.projectName}, ${node.workspace.name}`}
        testID={`task-agent-${node.agent.id}`}
      >
        <View style={styles.taskTop}>
          <TaskSignal state={node.state} />
          <Text
            numberOfLines={2}
            style={[styles.taskTitle, node.contextOnly && styles.contextTitle]}
          >
            {node.agent.title ?? "Untitled agent"}
          </Text>
          <Text style={styles.age}>{age}</Text>
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
      </Pressable>
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
  search: { flexDirection: "row" },
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
