// CUSTOM(projects-assistant): Projects Conversations. Dive from an orchestrator to its tasks and to
// the conversations of the agents it started.
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { assistantTreeRpc } from "../../shared/assistant-rpc";
import { usePaseoLanguage } from "../paseo-language";
import {
  filterTree,
  firstRunningAgent,
  locate,
  treeIsEmpty,
} from "./conversations-format";
import { conversationsStrings } from "./conversations-strings";
import { ConversationThread } from "./conversations-thread";
import { ConversationsTree } from "./conversations-tree";
import { selectConversation, useConversationSelection } from "./nav";

const COMPACT_WIDTH = 900;

function toggled(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

export function ConversationsScreen(props: PluginSurfaceProps) {
  const t = conversationsStrings(usePaseoLanguage());
  const callTree = useRpc(assistantTreeRpc);
  const { width } = useWindowDimensions();
  const compact = props.layout.compact || width < COMPACT_WIDTH;
  const shared = useConversationSelection();
  const tree = useQuery({
    queryKey: ["power-workboard", "assistant-tree", props.host.id],
    queryFn: () => callTree({}),
    refetchInterval: 5_000,
  });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(shared);
  const [expandedOrchestrators, setExpandedOrchestrators] = useState(
    () => new Set<string>(),
  );
  const [expandedTasks, setExpandedTasks] = useState(() => new Set<string>());
  const [showThread, setShowThread] = useState(shared.agentId !== null);
  const data = tree.data;

  const expandFor = (agentId: string | null, taskId: string | null) => {
    if (!data) return;
    const place = locate(data, agentId, taskId);
    if (!place) return;
    setExpandedOrchestrators((s) =>
      s.has(place.orchestratorKey) ? s : toggled(s, place.orchestratorKey),
    );
    setExpandedTasks((s) =>
      s.has(place.taskId) ? s : toggled(s, place.taskId),
    );
  };

  // A selection made on the dashboard.
  useEffect(() => {
    if (
      shared.agentId === selected.agentId &&
      shared.taskId === selected.taskId
    )
      return;
    setSelected(shared);
    if (shared.agentId) setShowThread(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared.agentId, shared.taskId]);

  // Expand the selection once the tree knows it.
  useEffect(() => {
    expandFor(selected.agentId, selected.taskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.agentId, selected.taskId, data]);

  // Nothing selected: the first running agent.
  useEffect(() => {
    if (!data || selected.agentId) return;
    const first = firstRunningAgent(data);
    if (first) {
      setSelected(first);
      selectConversation(first);
    }
  }, [data, selected.agentId]);

  const filtered = useMemo(
    () => (data ? filterTree(data, search) : { orchestrators: [] }),
    [data, search],
  );
  const taskTitle = useMemo(() => {
    if (!data) return null;
    for (const o of data.orchestrators)
      for (const task of o.tasks)
        if (
          task.taskId === selected.taskId ||
          task.agents.some((a) => a.agentId === selected.agentId)
        )
          return task.title;
    return null;
  }, [data, selected]);

  const select = (agentId: string, taskId: string | null) => {
    const next = { agentId, taskId };
    setSelected(next);
    selectConversation(next);
    setShowThread(true);
  };

  const c = props.theme.colors;
  const treePane = (
    <ConversationsTree
      tree={data}
      filtered={filtered}
      error={tree.isError}
      empty={data ? treeIsEmpty(data) : false}
      search={search}
      onSearch={setSearch}
      expandedOrchestrators={expandedOrchestrators}
      expandedTasks={expandedTasks}
      onToggleOrchestrator={(key) =>
        setExpandedOrchestrators((s) => toggled(s, key))
      }
      onToggleTask={(id) => setExpandedTasks((s) => toggled(s, id))}
      selectedAgentId={selected.agentId}
      selectedTaskId={selected.taskId}
      onSelect={select}
      now={Date.now()}
      compact={compact}
      t={t}
      theme={props.theme}
    />
  );
  const threadPane = selected.agentId ? (
    <ConversationThread
      agentId={selected.agentId}
      taskId={selected.taskId}
      taskTitle={taskTitle}
      navigation={props.navigation}
      hostId={props.host.id}
      compact={compact}
      onBack={() => setShowThread(false)}
      onSelectAgent={(agentId) => select(agentId, selected.taskId)}
      now={Date.now()}
      t={t}
      theme={props.theme}
    />
  ) : (
    <View style={styles.empty}>
      <Text style={[styles.emptyText, { color: c.foregroundMuted }]}>
        {t.noAgentSelected}
      </Text>
    </View>
  );

  if (compact) {
    return (
      <View style={[styles.screen, { backgroundColor: c.surface0 }]}>
        {showThread && selected.agentId ? (
          threadPane
        ) : (
          <View style={styles.full}>{treePane}</View>
        )}
      </View>
    );
  }
  return (
    <View style={[styles.screen, styles.row, { backgroundColor: c.surface0 }]}>
      {treePane}
      {threadPane}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: "row" },
  full: { flex: 1, alignItems: "stretch" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emptyText: { fontSize: 13 },
});
