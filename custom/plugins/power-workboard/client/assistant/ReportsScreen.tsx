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
import { projectColor } from "../colors";
import { usePaseoLocale } from "../paseo-language";
import { relativeTime } from "./conversations-format";
import { filterReportTasks, reportProjects } from "./reports-format";
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

  const all = useMemo(() => tasks.data?.tasks ?? [], [tasks.data]);
  const projects = useMemo(() => reportProjects(all), [all]);
  const filtered = useMemo(
    () => filterReportTasks(all, search, projectId),
    [all, search, projectId],
  );

  // Wide layouts always show a ticket: the newest one until the user picks another.
  useEffect(() => {
    if (compact || selectedId || all.length === 0) return;
    setSelectedId(all[0].taskId);
  }, [compact, selectedId, all]);

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
            {t.noMatches}
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
