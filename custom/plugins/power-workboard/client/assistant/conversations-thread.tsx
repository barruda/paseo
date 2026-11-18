// CUSTOM(projects-assistant): the conversation column of Projects Conversations.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  Icon,
  ScrollView,
  TextInput,
} from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Attempt,
  Conversation,
  ConversationItem,
  Report,
} from "../../shared/assistant";
import {
  assistantActionRpc,
  assistantConversationRpc,
} from "../../shared/assistant-rpc";
import {
  attemptDuration,
  attemptLabel,
  mergeItems,
  pollInterval,
  splitFences,
  stripReport,
} from "./conversations-format";
import type { ConversationsStrings } from "./conversations-strings";
import { showReport } from "./nav";
import { Badge, Dot, statusColor } from "./conversations-tree";

type Theme = PluginSurfaceProps["theme"];

interface OlderState {
  agentId: string;
  items: ConversationItem[];
  hasOlder: boolean;
  cursor: Conversation["cursor"];
}

function errorText(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return message ? `${fallback}: ${message}` : fallback;
}

function Collapsible(props: {
  title: ReactNode;
  theme: Theme;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const c = props.theme.colors;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={styles.collapseHead}
      >
        <Icon
          name={open ? "ChevronDown" : "ChevronRight"}
          size={14}
          color={c.foregroundMuted}
        />
        {props.title}
      </Pressable>
      {open ? props.children : null}
    </View>
  );
}

// CUSTOM(assistant-reports): exported for the Reports page.
export function RichText({
  text,
  color,
  theme,
}: {
  text: string;
  color: string;
  theme: Theme;
}) {
  return (
    <View style={styles.richText}>
      {splitFences(text).map((segment, index) =>
        segment.kind === "code" ? (
          <View
            key={index}
            style={[
              styles.code,
              {
                backgroundColor: theme.colors.surface2,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Text selectable style={[styles.mono, { color }]}>
              {segment.text}
            </Text>
          </View>
        ) : (
          <Text key={index} selectable style={[styles.body, { color }]}>
            {segment.text}
          </Text>
        ),
      )}
    </View>
  );
}

function MessageRow({
  item,
  t,
  theme,
}: {
  item: ConversationItem;
  t: ConversationsStrings;
  theme: Theme;
}) {
  const c = theme.colors;
  if (item.kind === "user" || item.kind === "assistant") {
    const user = item.kind === "user";
    return (
      <View
        style={[
          styles.bubble,
          user ? styles.bubbleUser : styles.bubbleAssistant,
          {
            backgroundColor: user ? c.accent : c.surface1,
            borderColor: user ? c.accent : c.border,
          },
        ]}
      >
        <RichText
          text={item.text}
          color={user ? c.accentForeground : c.foreground}
          theme={theme}
        />
      </View>
    );
  }
  if (item.kind === "tool") {
    const failed = item.toolStatus === "failed" || item.toolStatus === "error";
    return (
      <Collapsible
        theme={theme}
        title={
          <View style={styles.toolTitle}>
            <Icon name="Wrench" size={12} color={c.foregroundMuted} />
            <Text
              style={[styles.meta, { color: c.foreground }]}
              numberOfLines={1}
            >
              {item.toolName ?? "tool"}
            </Text>
            {item.toolStatus ? (
              <Text
                style={[
                  styles.meta,
                  { color: failed ? c.statusDanger : c.foregroundMuted },
                ]}
              >
                {item.toolStatus}
              </Text>
            ) : null}
          </View>
        }
      >
        <View
          style={[
            styles.code,
            { backgroundColor: c.surface2, borderColor: c.border },
          ]}
        >
          <Text selectable style={[styles.mono, { color: c.foreground }]}>
            {item.text}
          </Text>
        </View>
      </Collapsible>
    );
  }
  if (item.kind === "thought") {
    return (
      <View style={styles.dim}>
        <Collapsible
          theme={theme}
          title={
            <Text style={[styles.meta, { color: c.foregroundMuted }]}>
              {t.thought}
            </Text>
          }
        >
          <Text selectable style={[styles.body, { color: c.foregroundMuted }]}>
            {item.text}
          </Text>
        </Collapsible>
      </View>
    );
  }
  return (
    <Text
      selectable
      style={[styles.meta, styles.system, { color: c.foregroundMuted }]}
    >
      {item.text}
    </Text>
  );
}

function ReportCard({
  report,
  t,
  theme,
}: {
  report: Report;
  t: ConversationsStrings;
  theme: Theme;
}) {
  const c = theme.colors;
  const color =
    report.status === "done"
      ? c.statusSuccess
      : report.status === "failed"
        ? c.statusDanger
        : report.status === "checkpoint" // CUSTOM(task-checkpoints)
          ? c.accent
          : c.statusWarning;
  return (
    <View
      style={[
        styles.card,
        { borderColor: c.border, backgroundColor: c.surface1 },
      ]}
    >
      <View style={styles.cardHead}>
        <Text style={[styles.section, { color: c.foreground }]}>
          {t.report}
        </Text>
        <Badge
          text={t.reportStatus[report.status] ?? report.status}
          color={color}
        />
      </View>
      <Text selectable style={[styles.body, { color: c.foreground }]}>
        {report.summary}
      </Text>
      {report.filesChanged.length > 0 && (
        <Collapsible
          theme={theme}
          title={
            <Text style={[styles.meta, { color: c.foregroundMuted }]}>
              {t.filesChanged} ({report.filesChanged.length})
            </Text>
          }
        >
          {report.filesChanged.map((file) => (
            <Text
              key={file}
              selectable
              style={[styles.mono, { color: c.foreground }]}
            >
              {file}
            </Text>
          ))}
        </Collapsible>
      )}
      {report.checks.length > 0 && (
        <View style={styles.block}>
          <Text style={[styles.meta, { color: c.foregroundMuted }]}>
            {t.checks}
          </Text>
          {report.checks.map((check, index) => (
            <Text
              key={index}
              selectable
              style={[styles.mono, { color: c.foreground }]}
            >
              <Text
                style={{
                  color: check.passed ? c.statusSuccess : c.statusDanger,
                }}
              >
                {check.passed ? "✓" : "✗"}
              </Text>{" "}
              {check.command}
            </Text>
          ))}
        </View>
      )}
      {report.risks.length > 0 && (
        <View style={styles.block}>
          <Text style={[styles.meta, { color: c.foregroundMuted }]}>
            {t.risks}
          </Text>
          {report.risks.map((risk, index) => (
            <Text
              key={index}
              selectable
              style={[styles.body, { color: c.foreground }]}
            >
              • {risk}
            </Text>
          ))}
        </View>
      )}
      {report.question ? (
        <View style={styles.block}>
          <Text style={[styles.meta, { color: c.statusWarning }]}>
            {t.question}
          </Text>
          <Text selectable style={[styles.body, { color: c.foreground }]}>
            {report.question}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function outcomeColor(outcome: Attempt["outcome"], theme: Theme): string {
  const c = theme.colors;
  if (outcome === "done") return c.statusSuccess;
  if (outcome === "running" || outcome === "checkpoint") return c.accent; // CUSTOM(task-checkpoints)
  if (
    outcome === "no-report" ||
    outcome === "needs_input" ||
    outcome === "blocked"
  )
    return c.statusWarning;
  return c.statusDanger;
}

function AttemptsTimeline(props: {
  attempts: Attempt[];
  selectedAgentId: string;
  onSelect(agentId: string): void;
  now: number;
  t: ConversationsStrings;
  theme: Theme;
}) {
  const { t, theme } = props;
  const c = theme.colors;
  const [open, setOpen] = useState<number | null>(null);
  const opened = props.attempts.find((a) => a.index === open);
  return (
    <View style={styles.block}>
      <Text style={[styles.section, { color: c.foreground }]}>
        {t.attempts}
      </Text>
      <View style={styles.chips}>
        {props.attempts.map((attempt) => {
          const selected = attempt.agentId === props.selectedAgentId;
          const duration = attemptDuration(attempt, props.now);
          return (
            <Pressable
              key={attempt.index}
              accessibilityRole="button"
              onPress={() => {
                if (attempt.feedback)
                  setOpen(open === attempt.index ? null : attempt.index);
                if (attempt.agentId) props.onSelect(attempt.agentId);
              }}
              style={[
                styles.chip,
                {
                  borderColor: selected ? c.accent : c.border,
                  backgroundColor: c.surface1,
                },
              ]}
            >
              <Dot color={outcomeColor(attempt.outcome, theme)} />
              <Text style={[styles.meta, { color: c.foreground }]}>
                {attemptLabel(attempt, t)} ·{" "}
                {t.outcome[attempt.outcome] ?? attempt.outcome}
                {duration ? ` · ${duration}` : ""}
              </Text>
              {attempt.feedback ? (
                <Icon
                  name={open === attempt.index ? "ChevronUp" : "ChevronDown"}
                  size={12}
                  color={c.foregroundMuted}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {opened?.feedback ? (
        <View
          style={[
            styles.card,
            { borderColor: c.border, backgroundColor: c.surface1 },
          ]}
        >
          <Text style={[styles.meta, { color: c.foregroundMuted }]}>
            {t.feedback}
          </Text>
          <Text selectable style={[styles.body, { color: c.foreground }]}>
            {opened.feedback}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function logColor(level: "info" | "warn" | "error", theme: Theme): string {
  if (level === "error") return theme.colors.statusDanger;
  if (level === "warn") return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

export function ConversationThread(props: {
  agentId: string;
  taskId: string | null;
  taskTitle: string | null;
  navigation: PluginSurfaceProps["navigation"];
  hostId: string;
  compact: boolean;
  onBack(): void;
  onSelectAgent(agentId: string): void;
  now: number;
  t: ConversationsStrings;
  theme: Theme;
}) {
  const { t, theme, agentId } = props;
  const c = theme.colors;
  const callConversation = useRpc(assistantConversationRpc);
  const callAction = useRpc(assistantActionRpc);
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["power-workboard", "conversation", props.hostId, agentId],
    queryFn: () => callConversation({ agentId }),
    refetchInterval: (q) => pollInterval(q.state.data?.status),
  });
  const data = query.data;
  const [older, setOlder] = useState<OlderState | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const [text, setText] = useState("");
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const scroller = useRef<{
    scrollToEnd(options?: { animated?: boolean }): void;
    scrollTo(options: { y: number; animated?: boolean }): void;
  } | null>(null);
  const atBottom = useRef(true);
  const offset = useRef(0);
  const height = useRef(0);
  const prepend = useRef<{ height: number; offset: number } | null>(null);

  useEffect(() => {
    setOlder(null);
    setOlderError(false);
    setError(null);
    setText("");
    setFeedbackMode(false);
    setConfirmMerge(false);
    atBottom.current = true;
  }, [agentId]);

  const mine = older && older.agentId === agentId ? older : null;
  const items = (data ? mergeItems(mine?.items ?? [], data.items) : []).flatMap(
    (item) => {
      if (item.kind !== "assistant") return [item];
      const stripped = stripReport(item.text);
      return stripped
        ? [stripped === item.text ? item : { ...item, text: stripped }]
        : [];
    },
  );
  const hasOlder = mine ? mine.hasOlder : (data?.hasOlder ?? false);
  const cursor = mine ? mine.cursor : (data?.cursor ?? null);
  const taskId = data?.taskId ?? props.taskId;
  const status = data?.status ?? "gone";

  const loadOlder = useCallback(async () => {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(false);
    try {
      const page = await callConversation({ agentId, before: cursor });
      prepend.current = { height: height.current, offset: offset.current };
      setOlder((current) => ({
        agentId,
        items: mergeItems(
          page.items,
          current && current.agentId === agentId ? current.items : [],
        ),
        hasOlder: page.hasOlder,
        cursor: page.cursor,
      }));
    } catch {
      setOlderError(true);
    } finally {
      setLoadingOlder(false);
    }
  }, [agentId, callConversation, cursor, loadingOlder]);

  const refresh = useCallback(() => {
    void cache.invalidateQueries({
      queryKey: ["power-workboard", "conversation"],
    });
    void cache.invalidateQueries({
      queryKey: ["power-workboard", "assistant-tree"],
    });
  }, [cache]);

  const run = useCallback(
    async (input: Parameters<typeof callAction>[0]): Promise<boolean> => {
      setSending(true);
      setError(null);
      try {
        await callAction(input);
        refresh();
        return true;
      } catch (caught) {
        setError(errorText(caught, t.sendFailed));
        return false;
      } finally {
        setSending(false);
      }
    },
    [callAction, refresh, t.sendFailed],
  );

  const submit = async () => {
    const value = text.trim();
    if (!value || sending) return;
    const ok =
      feedbackMode && taskId
        ? await run({ type: "continue", taskId, feedback: value })
        : await run({ type: "send", agentId, text: value });
    if (ok) {
      setText("");
      setFeedbackMode(false);
      atBottom.current = true;
    }
  };

  const quick = (label: string, onPress: () => void, active = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={sending || !taskId}
      onPress={onPress}
      style={[
        styles.quick,
        {
          borderColor: active ? c.accent : c.border,
          backgroundColor: c.surface1,
          opacity: sending || !taskId ? 0.5 : 1,
        },
      ]}
    >
      <Text style={[styles.meta, { color: c.foreground }]}>{label}</Text>
    </Pressable>
  );

  const title = data?.title?.trim() || t.attempt;
  return (
    <View style={[styles.thread, { backgroundColor: c.surface0 }]}>
      <View style={[styles.header, { borderColor: c.border }]}>
        {props.compact ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.back}
            onPress={props.onBack}
          >
            <Icon name="ArrowLeft" size={18} color={c.foreground} />
          </Pressable>
        ) : null}
        <View style={styles.grow}>
          {props.taskTitle ? (
            <Text
              style={[styles.section, { color: c.foreground }]}
              numberOfLines={1}
            >
              {props.taskTitle}
            </Text>
          ) : null}
          <View style={styles.titleLine}>
            <Dot color={statusColor(status, theme)} />
            <Text
              style={[styles.meta, { color: c.foregroundMuted }]}
              numberOfLines={1}
            >
              {title} · {t.agentStatus[status] ?? status}
            </Text>
          </View>
        </View>
        {taskId ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => showReport(props.navigation, taskId)}
            style={[
              styles.quick,
              { borderColor: c.border, backgroundColor: c.surface1 },
            ]}
          >
            <Icon name="FileText" size={12} color={c.foreground} />
            <Text style={[styles.meta, { color: c.foreground }]}>
              {t.openReport}
            </Text>
          </Pressable>
        ) : null}
        {props.navigation?.openAgent ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => props.navigation?.openAgent({ agentId })}
            style={[
              styles.quick,
              { borderColor: c.border, backgroundColor: c.surface1 },
            ]}
          >
            <Icon name="ExternalLink" size={12} color={c.foreground} />
            <Text style={[styles.meta, { color: c.foreground }]}>
              {t.openInDesk}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {query.isError && !data ? (
        <Text style={[styles.note, { color: c.statusDanger }]}>
          {t.loadFailed}
        </Text>
      ) : !data ? (
        <Text style={[styles.note, { color: c.foregroundMuted }]}>
          {t.loading}
        </Text>
      ) : (
        <ScrollView
          ref={scroller as never}
          style={styles.grow}
          contentContainerStyle={styles.content}
          scrollEventThrottle={50}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } =
              event.nativeEvent;
            offset.current = contentOffset.y;
            atBottom.current =
              contentSize.height -
                (contentOffset.y + layoutMeasurement.height) <
              40;
          }}
          onContentSizeChange={(_width, h) => {
            const pending = prepend.current;
            if (pending) {
              prepend.current = null;
              scroller.current?.scrollTo({
                y: pending.offset + (h - pending.height),
                animated: false,
              });
            } else if (atBottom.current) {
              scroller.current?.scrollToEnd({ animated: false });
            }
            height.current = h;
          }}
        >
          {data.report ? (
            <ReportCard report={data.report} t={t} theme={theme} />
          ) : null}
          {data.attempts.length > 0 ? (
            <AttemptsTimeline
              attempts={data.attempts}
              selectedAgentId={agentId}
              onSelect={props.onSelectAgent}
              now={props.now}
              t={t}
              theme={theme}
            />
          ) : null}
          {hasOlder ? (
            <Pressable
              accessibilityRole="button"
              disabled={loadingOlder}
              onPress={() => void loadOlder()}
              style={styles.loadOlder}
            >
              <Text
                style={[
                  styles.meta,
                  { color: olderError ? c.statusDanger : c.accent },
                ]}
              >
                {olderError
                  ? t.loadFailed
                  : loadingOlder
                    ? t.loadingOlder
                    : t.loadOlder}
              </Text>
            </Pressable>
          ) : null}
          {items.length === 0 ? (
            <Text style={[styles.note, { color: c.foregroundMuted }]}>
              {t.noMessages}
            </Text>
          ) : (
            items.map((item) => (
              <MessageRow key={item.id} item={item} t={t} theme={theme} />
            ))
          )}
          <Collapsible
            theme={theme}
            title={
              <Text style={[styles.meta, { color: c.foregroundMuted }]}>
                {t.orchestratorLog}
              </Text>
            }
          >
            {data.log.length === 0 ? (
              <Text style={[styles.meta, { color: c.foregroundMuted }]}>
                {t.noLog}
              </Text>
            ) : (
              data.log.map((line, index) => (
                <Text
                  key={index}
                  selectable
                  style={[styles.mono, { color: logColor(line.level, theme) }]}
                >
                  {new Date(line.at).toLocaleTimeString()} {line.level}{" "}
                  {line.text}
                </Text>
              ))
            )}
          </Collapsible>
        </ScrollView>
      )}

      <View style={[styles.composer, { borderColor: c.border }]}>
        <View style={styles.quickRow}>
          {quick(
            t.continueWithFeedback,
            () => setFeedbackMode(!feedbackMode),
            feedbackMode,
          )}
          {quick(t.markDone, () => {
            if (taskId) void run({ type: "mark-done", taskId });
          })}
          {quick(t.mergeNow, () => setConfirmMerge(true))}
        </View>
        {confirmMerge ? (
          <View
            style={[
              styles.card,
              { borderColor: c.statusWarning, backgroundColor: c.surface1 },
            ]}
          >
            <Text style={[styles.body, { color: c.foreground }]}>
              {t.mergeConfirm}
            </Text>
            <View style={styles.quickRow}>
              {quick(t.confirm, () => {
                setConfirmMerge(false);
                if (taskId) void run({ type: "merge-now", taskId });
              })}
              {quick(t.cancel, () => setConfirmMerge(false))}
            </View>
          </View>
        ) : null}
        {error ? (
          <Text style={[styles.meta, { color: c.statusDanger }]}>{error}</Text>
        ) : null}
        <View style={styles.inputRow}>
          <TextInput
            multiline
            accessibilityLabel={
              feedbackMode ? t.feedbackPlaceholder : t.composerPlaceholder
            }
            value={text}
            onChangeText={setText}
            placeholder={
              feedbackMode ? t.feedbackPlaceholder : t.composerPlaceholder
            }
            placeholderTextColor={c.foregroundMuted}
            style={[
              styles.input,
              {
                color: c.foreground,
                borderColor: c.border,
                backgroundColor: c.surface1,
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            disabled={sending || text.trim().length === 0}
            onPress={() => void submit()}
            style={[
              styles.send,
              {
                backgroundColor: c.accent,
                opacity: sending || text.trim().length === 0 ? 0.5 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.meta,
                { color: c.accentForeground, fontWeight: "600" },
              ]}
            >
              {sending ? t.sending : feedbackMode ? t.sendFeedback : t.send}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  thread: { flex: 1, minWidth: 0 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderBottomWidth: 1,
  },
  grow: { flex: 1, minWidth: 0 },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  content: { padding: 12, gap: 8 },
  note: { fontSize: 13, padding: 16 },
  section: { fontSize: 14, fontWeight: "600" },
  body: { fontSize: 13, lineHeight: 19 },
  meta: { fontSize: 12 },
  mono: { fontSize: 12, fontFamily: "monospace" },
  richText: { gap: 6 },
  code: { borderWidth: 1, borderRadius: 6, padding: 8 },
  bubble: { maxWidth: "88%", borderWidth: 1, borderRadius: 12, padding: 10 },
  bubbleUser: { alignSelf: "flex-end" },
  bubbleAssistant: { alignSelf: "flex-start" },
  system: { alignSelf: "center", fontStyle: "italic" },
  dim: { opacity: 0.6 },
  toolTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
  },
  collapseHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 3,
  },
  card: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  block: { gap: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  loadOlder: { alignSelf: "center", padding: 6 },
  composer: { borderTopWidth: 1, padding: 10, gap: 8 },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  quick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  send: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11 },
});
