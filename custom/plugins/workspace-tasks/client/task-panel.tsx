import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type PluginWorkspacePanelProps, useAgent, useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  addTaskRpc,
  clearDoneTasksRpc,
  listTasksRpc,
  moveTaskRpc,
  removeTaskRpc,
  setAutoNextRpc,
  type Task,
  updateTaskRpc,
  type WorkspaceTasks,
} from "../shared/tasks";

type Theme = PluginWorkspacePanelProps["theme"];
type Styles = ReturnType<typeof createStyles>;

/** Agents change tasks from the daemon (`/next`, auto-next), so the panel polls. */
const REFRESH_MS = 2000;

const STATUS_ICON: Record<Task["status"], string> = {
  pending: "Circle",
  active: "CirclePlay",
  done: "CircleCheck",
};

interface TaskActions {
  toggle(task: Task): void;
  edit(id: string, text: string): void;
  move(id: string, offset: number): void;
  remove(id: string): void;
}

export function TaskPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["workspace-tasks", workspaceId], [workspaceId]);
  const list = useRpc(listTasksRpc);
  const add = useRpc(addTaskRpc);
  const update = useRpc(updateTaskRpc);
  const remove = useRpc(removeTaskRpc);
  const move = useRpc(moveTaskRpc);
  const clearDone = useRpc(clearDoneTasksRpc);
  const setAuto = useRpc(setAutoNextRpc);

  const query = useQuery({
    queryKey,
    queryFn: () => list({ workspaceId }),
    refetchInterval: REFRESH_MS,
  });
  const { mutate } = useMutation({
    mutationFn: (change: () => Promise<WorkspaceTasks>) => change(),
    onSuccess: (state) => queryClient.setQueryData(queryKey, state),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const [draft, setDraft] = useState("");
  const submitDraft = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    mutate(() => add({ workspaceId, text }));
  }, [add, draft, mutate, workspaceId]);
  const clearDoneTasks = useCallback(
    () => mutate(() => clearDone({ workspaceId })),
    [clearDone, mutate, workspaceId],
  );
  const autoAgentId = query.data?.autoAgentId ?? null;
  const turnOffAuto = useCallback(() => {
    if (autoAgentId) mutate(() => setAuto({ workspaceId, agentId: autoAgentId, enabled: false }));
  }, [autoAgentId, mutate, setAuto, workspaceId]);
  const actions = useMemo<TaskActions>(
    () => ({
      toggle: (task) =>
        mutate(() =>
          update({
            workspaceId,
            id: task.id,
            status: task.status === "done" ? "pending" : "done",
          }),
        ),
      edit: (id, text) => mutate(() => update({ workspaceId, id, text })),
      move: (id, offset) => mutate(() => move({ workspaceId, id, offset })),
      remove: (id) => mutate(() => remove({ workspaceId, id })),
    }),
    [move, mutate, remove, update, workspaceId],
  );

  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
  const tasks = query.data?.tasks ?? [];
  const pending = tasks.filter((task) => task.status === "pending").length;
  const done = tasks.filter((task) => task.status === "done").length;

  let notice: ReactNode = null;
  if (query.error) {
    notice = <Text style={styles.error}>{String(query.error)}</Text>;
  } else if (tasks.length === 0 && !query.isPending) {
    notice = (
      <Text style={styles.empty}>
        No tasks yet. Add some here or with /task in an agent&apos;s chat, then run /next in that
        chat to send the first one.
      </Text>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submitDraft}
          placeholder="Add a task"
          placeholderTextColor={theme.colors.foregroundMuted}
          blurOnSubmit={false}
          returnKeyType="done"
        />
        <Pressable
          style={styles.iconButton}
          onPress={submitDraft}
          accessibilityRole="button"
          accessibilityLabel="Add task"
        >
          <Icon name="Plus" size={16} color={theme.colors.foreground} />
        </Pressable>
      </View>
      <View style={styles.summary}>
        <Text style={styles.muted}>
          {pending} pending · {done} done
        </Text>
        {done > 0 ? (
          <Pressable onPress={clearDoneTasks} hitSlop={8}>
            <Text style={styles.link}>Clear done</Text>
          </Pressable>
        ) : null}
      </View>
      {autoAgentId ? (
        <AutoNextBar agentId={autoAgentId} theme={theme} styles={styles} onTurnOff={turnOffAuto} />
      ) : null}
      {notice}
      <ScrollView style={styles.list}>
        {tasks.map((task, index) => (
          <TaskRow
            key={task.id}
            task={task}
            theme={theme}
            styles={styles}
            first={index === 0}
            last={index === tasks.length - 1}
            actions={actions}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function AutoNextBar({
  agentId,
  theme,
  styles,
  onTurnOff,
}: {
  agentId: string;
  theme: Theme;
  styles: Styles;
  onTurnOff: () => void;
}) {
  const title = useAgent(agentId, (agent) => ({ title: agent.title }))?.title;
  return (
    <View style={styles.autoBar}>
      <Icon name="FastForward" size={14} color={theme.colors.accent} />
      <Text style={styles.autoText} numberOfLines={1}>
        Auto-next: {title ?? agentId}
      </Text>
      <Pressable onPress={onTurnOff} hitSlop={8}>
        <Text style={styles.link}>Turn off</Text>
      </Pressable>
    </View>
  );
}

function TaskRow({
  task,
  theme,
  styles,
  first,
  last,
  actions,
}: {
  task: Task;
  theme: Theme;
  styles: Styles;
  first: boolean;
  last: boolean;
  actions: TaskActions;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const agentTitle = useAgent(task.agentId ?? "", (agent) => ({ title: agent.title }))?.title;
  const statusColor = {
    pending: theme.colors.foregroundMuted,
    active: theme.colors.accent,
    done: theme.colors.statusSuccess,
  }[task.status];
  const commit = useCallback(() => {
    const text = editing?.trim();
    setEditing(null);
    if (text && text !== task.text) actions.edit(task.id, text);
  }, [actions, editing, task.id, task.text]);
  const startEditing = useCallback(() => setEditing(task.text), [task.text]);
  const toggle = useCallback(() => actions.toggle(task), [actions, task]);
  const moveUp = useCallback(() => actions.move(task.id, -1), [actions, task.id]);
  const moveDown = useCallback(() => actions.move(task.id, 1), [actions, task.id]);
  const remove = useCallback(() => actions.remove(task.id), [actions, task.id]);
  const checked = task.status === "done";

  return (
    <View style={styles.row}>
      <Pressable
        onPress={toggle}
        hitSlop={6}
        accessibilityRole="checkbox"
        accessibilityState={checked ? styles.checked : styles.unchecked}
        accessibilityLabel={checked ? "Mark as not done" : "Mark as done"}
      >
        <Icon name={STATUS_ICON[task.status]} size={16} color={statusColor} />
      </Pressable>
      <View style={styles.rowBody}>
        {editing === null ? (
          <Pressable onPress={startEditing}>
            <Text style={checked ? styles.textDone : styles.text}>{task.text}</Text>
          </Pressable>
        ) : (
          <TextInput
            style={styles.input}
            value={editing}
            onChangeText={setEditing}
            onSubmitEditing={commit}
            onBlur={commit}
            autoFocus
            multiline
          />
        )}
        {task.status === "active" ? (
          <Text style={styles.muted}>In progress · {agentTitle ?? task.agentId}</Text>
        ) : null}
      </View>
      <View style={styles.rowActions}>
        <Pressable onPress={moveUp} disabled={first} hitSlop={4} accessibilityLabel="Move up">
          <Icon
            name="ChevronUp"
            size={15}
            color={first ? theme.colors.border : theme.colors.foregroundMuted}
          />
        </Pressable>
        <Pressable onPress={moveDown} disabled={last} hitSlop={4} accessibilityLabel="Move down">
          <Icon
            name="ChevronDown"
            size={15}
            color={last ? theme.colors.border : theme.colors.foregroundMuted}
          />
        </Pressable>
        <Pressable onPress={remove} hitSlop={4} accessibilityLabel="Delete task">
          <Icon name="Trash2" size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(theme: Theme, compact: boolean) {
  return {
    checked: { checked: true },
    unchecked: { checked: false },
    screen: {
      flex: 1,
      gap: 10,
      padding: compact ? 12 : 16,
      backgroundColor: theme.colors.surface0,
    },
    composer: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    input: {
      flex: 1,
      minHeight: 32,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 6,
      color: theme.colors.foreground,
      fontSize: 13,
    },
    iconButton: {
      width: 32,
      height: 32,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      borderRadius: 6,
      backgroundColor: theme.colors.surface2,
    },
    summary: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
    },
    autoBar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      padding: 8,
      borderRadius: 6,
      backgroundColor: theme.colors.surface1,
    },
    autoText: { flex: 1, color: theme.colors.foreground, fontSize: 12 },
    list: { flex: 1 },
    row: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      gap: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    rowBody: { flex: 1, gap: 2 },
    rowActions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
    text: { color: theme.colors.foreground, fontSize: 13, lineHeight: 18 },
    textDone: {
      color: theme.colors.foregroundMuted,
      fontSize: 13,
      lineHeight: 18,
      textDecorationLine: "line-through" as const,
    },
    muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
    link: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" as const },
    empty: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
    error: { color: theme.colors.statusDanger, fontSize: 12 },
  };
}
