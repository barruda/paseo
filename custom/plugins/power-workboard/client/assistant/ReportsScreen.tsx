// CUSTOM(assistant-reports): Projects Reports. One timeline per ticket: what the assistant and the
// board did, newest ticket first.
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  Icon,
  ScrollView,
  TextInput,
} from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import {
  assistantReportsTaskRpc,
  assistantReportsTasksRpc,
} from "../../shared/assistant-rpc";
import { groupColorValue, projectColor } from "../colors";
import { usePaseoLocale } from "../paseo-language";
import { consumeReportTaskRequest, useReportTaskRequest } from "./nav";
import { relativeTime } from "./conversations-format";
import {
  defaultHiddenColumns,
  filterReportTasks,
  reportProjects,
  toggleHiddenColumn,
} from "./reports-format";
import {
  loadReportHiddenColumns,
  saveReportHiddenColumns,
} from "./reports-preferences";
import { reportsStrings } from "./reports-strings";
import { ReportContent } from "./reports-timeline";

const COMPACT_WIDTH = 900;

export function ReportsScreen(props: PluginSurfaceProps) {
  const t = reportsStrings(usePaseoLocale());
  const callTasks = useRpc(assistantReportsTasksRpc);
  const callTask = useRpc(assistantReportsTaskRpc);
  const { width } = useWindowDimensions();
  const compact = props.layout.compact || width < COMPACT_WIDTH;
  const hostId = props.host.id;
  const c = props.theme.colors;

  const tasks = useQuery({
    queryKey: ["power-workboard", "assistant-reports", hostId],
    queryFn: () => callTasks({}),
    refetchInterval: 10_000,
  });
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showContent, setShowContent] = useState(false);
  // The viewer's saved status filter; null until they toggle a status, so the default applies.
  const [savedHidden, setSavedHidden] = useState<string[] | null>(() =>
    loadReportHiddenColumns(hostId),
  );

  const all = useMemo(() => tasks.data?.tasks ?? [], [tasks.data]);
  const columns = useMemo(() => tasks.data?.columns ?? [], [tasks.data]);
  const hiddenColumns = useMemo(
    () => savedHidden ?? defaultHiddenColumns(columns),
    [savedHidden, columns],
  );
  const projects = useMemo(() => reportProjects(all), [all]);
  const filtered = useMemo(
    () => filterReportTasks(all, search, projectId, hiddenColumns),
    [all, search, projectId, hiddenColumns],
  );
  const hiddenByStatus = useMemo(
    () =>
      filtered.length === 0 &&
      filterReportTasks(all, search, projectId).length > 0,
    [filtered, all, search, projectId],
  );
  const toggleColumn = (columnId: string) => {
    const next = toggleHiddenColumn(hiddenColumns, columnId);
    setSavedHidden(next);
    saveReportHiddenColumns(hostId, next);
  };

  // Wide layouts always show a ticket: the newest visible one until the user picks another, and
  // again when the filters hide the one that was selected.
  useEffect(() => {
    if (compact) return;
    if (filtered.length === 0) {
      if (tasks.data && selectedId !== null) setSelectedId(null);
      return;
    }
    if (selectedId && filtered.some((task) => task.taskId === selectedId))
      return;
    setSelectedId(filtered[0].taskId);
  }, [compact, selectedId, filtered, tasks.data]);

  // A request from another page (Dashboard, Conversations) to open one ticket. It waits for the
  // list, clears the search and the project filter, and shows the ticket's column for this visit
  // when the status filter hides it (not saved), so the selection effect keeps the ticket.
  const request = useReportTaskRequest();
  useEffect(() => {
    if (!request || !tasks.data) return;
    // CUSTOM(assistant-reply-protocol): the chat links a short id, the first characters.
    const match =
      all.find((t) => t.taskId === request.taskId) ??
      all.find((t) => t.taskId.startsWith(request.taskId));
    const columnId = match?.columnId;
    if (columnId && hiddenColumns.includes(columnId))
      setSavedHidden(hiddenColumns.filter((id) => id !== columnId));
    setSearch("");
    setProjectId(null);
    setSelectedId(match?.taskId ?? request.taskId);
    setShowContent(true);
    consumeReportTaskRequest(request.seq);
  }, [request, tasks.data, all, hiddenColumns]);

  const timeline = useQuery({
    queryKey: ["power-workboard", "assistant-report", hostId, selectedId],
    queryFn: () => callTask({ taskId: selectedId as string }),
    refetchInterval: 10_000,
    enabled: selectedId !== null,
  });

  const now = Date.now();
  const list = (
    <View
      style={[
        styles.sidebar,
        compact && styles.sidebarFull,
        { borderColor: c.border, backgroundColor: c.surface0 },
      ]}
    >
      <View
        style={[
          styles.search,
          { borderColor: c.border, backgroundColor: c.surface1 },
        ]}
      >
        <Icon name="Search" size={16} color={c.foregroundMuted} />
        <TextInput
          accessibilityLabel={t.searchPlaceholder}
          value={search}
          onChangeText={setSearch}
          placeholder={t.searchPlaceholder}
          placeholderTextColor={c.foregroundMuted}
          style={[styles.searchInput, { color: c.foreground }]}
        />
        {search.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.clearSearch}
            onPress={() => setSearch("")}
          >
            <Icon name="X" size={16} color={c.foregroundMuted} />
          </Pressable>
        )}
      </View>
      {projects.length > 0 ? (
        <View style={styles.chips}>
          <Chip
            label={t.allProjects}
            color={c.accent}
            active={projectId === null}
            onPress={() => setProjectId(null)}
            theme={props.theme}
          />
          {projects.map((project) => (
            <Chip
              key={project.id}
              label={project.name}
              color={projectColor(project.name, props.theme)}
              active={projectId === project.id}
              onPress={() => setProjectId(project.id)}
              theme={props.theme}
            />
          ))}
        </View>
      ) : null}
      {columns.length > 0 ? (
        <View style={styles.chips} accessibilityLabel={t.statusFilter}>
          {columns.map((column) => {
            const shown = !hiddenColumns.includes(column.id);
            return (
              <Chip
                key={column.id}
                label={column.name}
                color={groupColorValue(column.color, props.theme)}
                active={shown}
                dimmed={!shown}
                onPress={() => toggleColumn(column.id)}
                theme={props.theme}
              />
            );
          })}
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.list}>
        {tasks.isError && !tasks.data ? (
          <Text style={[styles.note, { color: c.statusDanger }]}>
            {t.loadFailed}
          </Text>
        ) : !tasks.data ? (
          <Text style={[styles.note, { color: c.foregroundMuted }]}>
            {t.loading}
          </Text>
        ) : all.length === 0 ? (
          <Text style={[styles.note, { color: c.foregroundMuted }]}>
            {t.noTickets}
          </Text>
        ) : filtered.length === 0 ? (
          <Text style={[styles.note, { color: c.foregroundMuted }]}>
            {hiddenByStatus ? t.statusFilterHidesAll : t.noMatches}
          </Text>
        ) : (
          filtered.map((task) => {
            const selected = task.taskId === selectedId;
            return (
              <Pressable
                key={task.taskId}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  setSelectedId(task.taskId);
                  setShowContent(true);
                }}
                style={[
                  styles.row,
                  selected && { backgroundColor: c.surface2 },
                ]}
              >
                <Text
                  style={[styles.name, { color: c.foreground }]}
                  numberOfLines={2}
                >
                  {task.title}
                </Text>
                <Text
                  style={[
                    styles.meta,
                    { color: projectColor(task.projectName, props.theme) },
                  ]}
                  numberOfLines={1}
                >
                  {task.projectName}
                </Text>
                <View style={styles.badges}>
                  <Text style={[styles.meta, { color: c.foregroundMuted }]}>
                    {task.column ?? t.removedFromBoard}
                  </Text>
                  <Text style={[styles.meta, { color: c.foregroundMuted }]}>
                    {relativeTime(task.lastAt, now, t)}
                  </Text>
                </View>
                <Text
                  style={[styles.meta, { color: c.foregroundMuted }]}
                  numberOfLines={1}
                >
                  {task.lastSummary}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );

  const content = selectedId ? (
    <ReportContent
      timeline={timeline.data?.timeline}
      loading={timeline.isLoading}
      error={timeline.isError}
      taskId={selectedId}
      compact={compact}
      onBack={() => setShowContent(false)}
      now={now}
      navigation={props.navigation}
      t={t}
      theme={props.theme}
    />
  ) : (
    <View style={styles.empty}>
      <Text style={[styles.emptyText, { color: c.foregroundMuted }]}>
        {t.nothingSelected}
      </Text>
    </View>
  );

  if (compact) {
    return (
      <View style={[styles.screen, { backgroundColor: c.surface0 }]}>
        {showContent && selectedId ? (
          content
        ) : (
          <View style={styles.full}>{list}</View>
        )}
      </View>
    );
  }
  return (
    <View style={[styles.screen, styles.wide, { backgroundColor: c.surface0 }]}>
      {list}
      {content}
    </View>
  );
}

function Chip(props: {
  label: string;
  color: string;
  active: boolean;
  /** An unchecked toggle chip: drawn faded. */
  dimmed?: boolean;
  onPress(): void;
  theme: PluginSurfaceProps["theme"];
}) {
  const c = props.theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.active }}
      onPress={props.onPress}
      style={[
        styles.chip,
        { borderColor: props.color },
        props.active && { backgroundColor: c.surface2 },
        props.dimmed && styles.chipDimmed,
      ]}
    >
      <Text style={[styles.chipText, { color: props.color }]} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  wide: { flexDirection: "row" },
  full: { flex: 1, alignItems: "stretch" },
  sidebar: { width: 300, borderRightWidth: 1 },
  sidebarFull: { width: "100%", flex: 1, borderRightWidth: 0 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 8,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 8,
    height: 34,
  },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 0 },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: { fontSize: 11, fontWeight: "600" },
  chipDimmed: { opacity: 0.5 },
  list: { paddingBottom: 16 },
  row: { paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  name: { fontSize: 13, fontWeight: "500" },
  meta: { fontSize: 11 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  note: { fontSize: 12, padding: 12 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emptyText: { fontSize: 13 },
});
