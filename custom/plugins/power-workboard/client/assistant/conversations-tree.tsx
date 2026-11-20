// CUSTOM(projects-assistant): the orchestrator → task → agent tree of Projects Conversations.
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  Icon,
  ScrollView,
  TextInput,
} from "@getpaseo/plugin/client/react-native";
import type { Tree } from "../../shared/assistant";
import { projectAccentColor } from "../colors";
import type { ProjectAccents } from "../project-accents";
import {
  agentLabel,
  orchestratorKey,
  relativeTime,
} from "./conversations-format";
import type { ConversationsStrings } from "./conversations-strings";

type Theme = PluginSurfaceProps["theme"];

export function statusColor(status: string, theme: Theme): string {
  if (status === "running") return theme.colors.statusSuccess;
  if (status === "error") return theme.colors.statusDanger;
  if (status === "idle") return theme.colors.accent;
  return theme.colors.foregroundMuted;
}

export function Dot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export function stageColor(stage: string, theme: Theme): string {
  if (stage === "delivered") return theme.colors.statusSuccess;
  if (stage === "needs-you") return theme.colors.statusWarning;
  if (stage === "dismissed") return theme.colors.foregroundMuted;
  return theme.colors.accent;
}

export function ConversationsTree(props: {
  tree: Tree | undefined;
  filtered: Tree;
  error: boolean;
  empty: boolean;
  search: string;
  onSearch(value: string): void;
  collapsedOrchestrators: Set<string>;
  expandedTasks: Set<string>;
  onToggleOrchestrator(key: string): void;
  onToggleTask(id: string): void;
  selectedAgentId: string | null;
  selectedTaskId: string | null;
  onSelect(agentId: string, taskId: string): void;
  now: number;
  compact?: boolean;
  t: ConversationsStrings;
  theme: PluginSurfaceProps["theme"];
  accents: ProjectAccents;
}) {
  const { t, theme } = props;
  const c = theme.colors;
  const searching = props.search.trim().length > 0;
  return (
    <View
      style={[
        styles.tree,
        props.compact && styles.treeFull,
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
          accessibilityLabel={t.searchTasks}
          value={props.search}
          onChangeText={props.onSearch}
          placeholder={t.searchTasks}
          placeholderTextColor={c.foregroundMuted}
          style={[styles.searchInput, { color: c.foreground }]}
        />
        {props.search.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.clearSearch}
            onPress={() => props.onSearch("")}
          >
            <Icon name="X" size={16} color={c.foregroundMuted} />
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {props.error && !props.tree ? (
          <Text style={[styles.note, { color: c.statusDanger }]}>
            {t.treeFailed}
          </Text>
        ) : !props.tree ? (
          <Text style={[styles.note, { color: c.foregroundMuted }]}>
            {t.loading}
          </Text>
        ) : props.empty ? (
          <Text style={[styles.note, { color: c.foregroundMuted }]}>
            {t.noOrchestrators}
          </Text>
        ) : props.filtered.orchestrators.length === 0 ? (
          <Text style={[styles.note, { color: c.foregroundMuted }]}>
            {t.noMatches}
          </Text>
        ) : (
          props.filtered.orchestrators.map((orchestrator) => {
            const key = orchestratorKey(orchestrator);
            const open = searching || !props.collapsedOrchestrators.has(key);
            return (
              <View key={key}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  onPress={() => props.onToggleOrchestrator(key)}
                  style={styles.row}
                >
                  <Icon
                    name={open ? "ChevronDown" : "ChevronRight"}
                    size={14}
                    color={c.foregroundMuted}
                  />
                  <Dot
                    color={
                      orchestrator.active ? c.statusSuccess : c.foregroundMuted
                    }
                  />
                  <View style={styles.grow}>
                    <Text
                      style={[styles.name, { color: c.foreground }]}
                      numberOfLines={1}
                    >
                      {orchestrator.id === null
                        ? t.manualGroup
                        : orchestrator.name}
                    </Text>
                    {orchestrator.projectName ? (
                      <Text
                        style={[
                          styles.meta,
                          {
                            color: projectAccentColor(
                              props.accents.forProject(
                                null,
                                orchestrator.projectName,
                              ),
                              orchestrator.projectName,
                              theme,
                            ),
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {orchestrator.projectName}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
                {open &&
                  orchestrator.tasks.map((task) => {
                    const taskOpen =
                      searching ||
                      props.expandedTasks.has(task.taskId) ||
                      task.taskId === props.selectedTaskId;
                    return (
                      <View key={task.taskId} style={styles.indent1}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ expanded: taskOpen }}
                          onPress={() => props.onToggleTask(task.taskId)}
                          style={styles.row}
                        >
                          <Icon
                            name={taskOpen ? "ChevronDown" : "ChevronRight"}
                            size={14}
                            color={c.foregroundMuted}
                          />
                          <View style={styles.grow}>
                            <Text
                              style={[styles.name, { color: c.foreground }]}
                              numberOfLines={2}
                            >
                              {task.title}
                            </Text>
                            <View style={styles.badges}>
                              <Text
                                style={[
                                  styles.meta,
                                  { color: c.foregroundMuted },
                                ]}
                              >
                                {task.column}
                              </Text>
                              {task.deliveryStage ? (
                                <Badge
                                  text={
                                    t.stage[task.deliveryStage] ??
                                    task.deliveryStage
                                  }
                                  color={stageColor(task.deliveryStage, theme)}
                                />
                              ) : null}
                              <Text
                                style={[
                                  styles.meta,
                                  { color: c.foregroundMuted },
                                ]}
                              >
                                {relativeTime(task.updatedAt, props.now, t)}
                              </Text>
                            </View>
                          </View>
                        </Pressable>
                        {taskOpen &&
                          (task.agents.length === 0 ? (
                            <Text
                              style={[
                                styles.note,
                                styles.indent2,
                                { color: c.foregroundMuted },
                              ]}
                            >
                              {t.noAgents}
                            </Text>
                          ) : (
                            task.agents.map((agent, index) => {
                              const selected =
                                agent.agentId === props.selectedAgentId;
                              return (
                                <Pressable
                                  key={agent.agentId}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected }}
                                  onPress={() =>
                                    props.onSelect(agent.agentId, task.taskId)
                                  }
                                  style={[
                                    styles.row,
                                    styles.indent2,
                                    selected && { backgroundColor: c.surface2 },
                                  ]}
                                >
                                  <Dot
                                    color={statusColor(agent.status, theme)}
                                  />
                                  <Text
                                    style={[
                                      styles.agent,
                                      { color: c.foreground },
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {agentLabel(agent, index, t)}
                                  </Text>
                                  {agent.current ? (
                                    <Text
                                      style={[styles.meta, { color: c.accent }]}
                                    >
                                      {t.current}
                                    </Text>
                                  ) : null}
                                </Pressable>
                              );
                            })
                          ))}
                      </View>
                    );
                  })}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tree: { width: 300, borderRightWidth: 1 },
  treeFull: { width: "100%", flex: 1, borderRightWidth: 0 },
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
  list: { paddingBottom: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  grow: { flex: 1, minWidth: 0 },
  indent1: { paddingLeft: 12 },
  indent2: { paddingLeft: 28 },
  name: { fontSize: 13, fontWeight: "500" },
  agent: { flex: 1, fontSize: 13 },
  meta: { fontSize: 11 },
  badges: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: { fontSize: 10, fontWeight: "600" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  note: { fontSize: 12, padding: 12 },
});
