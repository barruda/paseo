// CUSTOM(assistant-reports): the content column of Projects Reports: the ticket header with what
// was asked, and its timeline of assistant and automatic items.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import type { Report } from "../../shared/assistant";
import { assistantActionRpc } from "../../shared/assistant-rpc";
import { itemFeedback, optionAnswer } from "../../shared/card-answers";
import type {
  ReportOrchestrator,
  ReportTimeline,
  ReportTimelineItem,
} from "../../shared/assistant-reports";
import { projectColor } from "../colors";
import { OutcomeMap, QuestionBlock } from "./card-parts";
import { RichText } from "./conversations-thread";
import { showConversation } from "./nav";
import {
  descriptionExcerpt,
  formatClock,
  kindIcon,
  kindTone,
  type Tone,
} from "./reports-format";
import type { ReportsStrings } from "./reports-strings";

type Theme = PluginSurfaceProps["theme"];

function toneColor(tone: Tone, theme: Theme): string {
  const c = theme.colors;
  switch (tone) {
    case "success":
      return c.statusSuccess;
    case "warning":
      return c.statusWarning;
    case "danger":
      return c.statusDanger;
    case "accent":
      return c.accent;
    default:
      return c.foregroundMuted;
  }
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function ReportBlock({
  report,
  agentId,
  interactive,
  t,
  theme,
}: {
  report: Report;
  agentId: string;
  /** Only the newest report of the ticket takes answers. */
  interactive: boolean;
  t: ReportsStrings;
  theme: Theme;
}) {
  const c = theme.colors;
  const act = useRpc(assistantActionRpc);
  const answer = async (text: string, question: string | null) => {
    await act({ type: "answer", agentId, text, question });
  };
  const color =
    report.status === "done"
      ? c.statusSuccess
      : report.status === "failed"
        ? c.statusDanger
        : c.statusWarning;
  return (
    <View
      style={[
        styles.card,
        { borderColor: c.border, backgroundColor: c.surface1 },
      ]}
    >
      <View style={styles.cardHead}>
        <Text style={[styles.label, { color: c.foreground }]}>{t.report}</Text>
        <Badge
          text={t.reportStatus[report.status] ?? report.status}
          color={color}
        />
      </View>
      <Text selectable style={[styles.body, { color: c.foreground }]}>
        {report.summary}
      </Text>
      <OutcomeMap
        outcomes={report.outcomes.map((o) => ({
          text: o.ask,
          evidence: o.evidence,
          detail: o.detail,
        }))}
        notDone={report.notDone}
        theme={theme}
        labels={t.card}
        onFeedback={
          interactive
            ? (item, feedback) => answer(itemFeedback(item, feedback), null)
            : undefined
        }
      />
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
        <QuestionBlock
          question={report.question}
          options={report.options}
          recommend={report.recommend}
          why={report.why}
          theme={theme}
          labels={t.card}
          onPick={
            interactive
              ? (option) =>
                  answer(
                    optionAnswer(report.question ?? "", option),
                    report.question,
                  )
              : undefined
          }
        />
      ) : null}
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
    </View>
  );
}

/** The id of the newest item, or folded event, that carries a report. */
function newestReportOwner(timeline: ReportTimeline): string | null {
  let newest: { id: string; at: string } | null = null;
  const consider = (id: string, at: string) => {
    if (!newest || at >= newest.at) newest = { id, at };
  };
  for (const item of timeline.items) {
    if (item.orchestrator?.report) consider(item.id, item.at);
    if (item.source === "assistant")
      for (const event of item.events)
        if (event.orchestrator?.report) consider(event.id, event.at);
  }
  return (newest as { id: string } | null)?.id ?? null;
}

function Interaction(props: {
  orchestrator: ReportOrchestrator;
  taskId: string;
  /** Whether this report is the ticket's newest, the only one that takes answers. */
  interactive: boolean;
  open: boolean;
  onToggle(): void;
  navigation: PluginSurfaceProps["navigation"];
  t: ReportsStrings;
  theme: Theme;
}) {
  const { orchestrator, t, theme } = props;
  const c = theme.colors;
  return (
    <View style={styles.block}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.open }}
        onPress={props.onToggle}
        style={styles.toggleRow}
      >
        <Icon
          name={props.open ? "ChevronDown" : "ChevronRight"}
          size={14}
          color={c.foregroundMuted}
        />
        <Icon name="Bot" size={14} color={c.foregroundMuted} />
        <Text style={[styles.label, { color: c.foreground }]}>
          {t.interaction}
        </Text>
      </Pressable>
      {props.open ? (
        <View style={[styles.inner, { borderColor: c.border }]}>
          {orchestrator.prompt ? (
            <View style={styles.block}>
              <Text style={[styles.meta, { color: c.foregroundMuted }]}>
                {t.prompt}
              </Text>
              <RichText
                text={orchestrator.prompt}
                color={c.foreground}
                theme={theme}
              />
            </View>
          ) : null}
          {orchestrator.reply ? (
            <View style={styles.block}>
              <Text style={[styles.meta, { color: c.foregroundMuted }]}>
                {t.answer}
              </Text>
              <RichText
                text={orchestrator.reply}
                color={c.foreground}
                theme={theme}
              />
            </View>
          ) : null}
          {orchestrator.report ? (
            <ReportBlock
              report={orchestrator.report}
              agentId={orchestrator.agentId}
              interactive={props.interactive}
              t={t}
              theme={theme}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              showConversation(
                props.navigation,
                orchestrator.agentId,
                props.taskId,
              )
            }
            style={[styles.button, { borderColor: c.border }]}
          >
            <Icon name="MessageSquare" size={14} color={c.accent} />
            <Text style={[styles.buttonText, { color: c.accent }]}>
              {t.openConversation}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** Who caused an automatic event; the board's own engine and unknown causes show nothing. */
function byLabel(
  by: "user" | "assistant" | "orchestrator" | null | undefined,
  t: ReportsStrings,
): string | null {
  if (by === "user") return t.card.byUser;
  if (by === "assistant") return t.card.byAssistant;
  return null;
}

function ItemRow(props: {
  item: ReportTimelineItem;
  taskId: string;
  /** The id of the newest item or folded event carrying a report. */
  newestReportId: string | null;
  open: boolean;
  /** Whether the item's or a folded event's Interaction is open, by id. */
  isInteractionOpen(id: string): boolean;
  onToggle(id: string): void;
  onToggleInteraction(id: string): void;
  now: number;
  navigation: PluginSurfaceProps["navigation"];
  t: ReportsStrings;
  theme: Theme;
}) {
  const { item, t, theme } = props;
  const c = theme.colors;
  const color = toneColor(kindTone(item), theme);
  const kindLabel =
    item.source === "assistant"
      ? t.entryKind[item.kind]
      : t.eventKind[item.kind];
  return (
    <View style={[styles.item, { borderColor: c.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.open }}
        accessibilityLabel={`${kindLabel}: ${item.summary}`}
        onPress={() => props.onToggle(item.id)}
        style={styles.toggleRow}
      >
        <Icon
          name={props.open ? "ChevronDown" : "ChevronRight"}
          size={14}
          color={c.foregroundMuted}
        />
        <Icon name={kindIcon(item)} size={16} color={color} />
        <View style={styles.grow}>
          <View style={styles.badges}>
            <Text style={[styles.meta, { color: c.foregroundMuted }]}>
              {formatClock(item.at, props.now)}
            </Text>
            <Text style={[styles.meta, { color }]}>{kindLabel}</Text>
            {item.source === "auto" ? (
              <Text style={[styles.meta, { color: c.foregroundMuted }]}>
                · {t.sourceAuto}
              </Text>
            ) : null}
            {item.source === "auto" && byLabel(item.by, t) ? (
              <Text style={[styles.meta, { color: c.foregroundMuted }]}>
                · {byLabel(item.by, t)}
              </Text>
            ) : null}
          </View>
          <Text
            style={[styles.summary, { color: c.foreground }]}
            numberOfLines={2}
          >
            {item.summary}
          </Text>
        </View>
      </Pressable>
      {props.open ? (
        <View style={styles.itemBody}>
          {item.detail ? (
            <View style={styles.block}>
              <Text style={[styles.meta, { color: c.foregroundMuted }]}>
                {t.details}
              </Text>
              <RichText text={item.detail} color={c.foreground} theme={theme} />
            </View>
          ) : null}
          {item.source === "assistant" && item.decisions.length > 0 ? (
            <View style={styles.block}>
              <Text style={[styles.meta, { color: c.foregroundMuted }]}>
                {t.decisions}
              </Text>
              {item.decisions.map((decision, index) => (
                <Text
                  key={index}
                  selectable
                  style={[styles.body, { color: c.foreground }]}
                >
                  • {decision}
                </Text>
              ))}
            </View>
          ) : null}
          {item.source === "assistant" && item.events.length > 0 ? (
            <View style={styles.block}>
              <Text style={[styles.meta, { color: c.foregroundMuted }]}>
                {t.automaticEvents}
              </Text>
              {item.events.map((event) => (
                <View key={event.id} style={styles.block}>
                  <Text
                    selectable
                    style={[styles.meta, { color: c.foregroundMuted }]}
                  >
                    {formatClock(event.at, props.now)} ·{" "}
                    {byLabel(event.by, t) ? `${byLabel(event.by, t)} · ` : ""}
                    {t.eventKind[event.kind]} · {event.text}
                  </Text>
                  {event.detail || event.orchestrator ? (
                    <View style={[styles.inner, { borderColor: c.border }]}>
                      {event.detail ? (
                        <RichText
                          text={event.detail}
                          color={c.foreground}
                          theme={theme}
                        />
                      ) : null}
                      {event.orchestrator ? (
                        <Interaction
                          orchestrator={event.orchestrator}
                          taskId={props.taskId}
                          interactive={props.newestReportId === event.id}
                          open={props.isInteractionOpen(event.id)}
                          onToggle={() => props.onToggleInteraction(event.id)}
                          navigation={props.navigation}
                          t={t}
                          theme={theme}
                        />
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
          {item.orchestrator ? (
            <Interaction
              orchestrator={item.orchestrator}
              taskId={props.taskId}
              interactive={props.newestReportId === item.id}
              open={props.isInteractionOpen(item.id)}
              onToggle={() => props.onToggleInteraction(item.id)}
              navigation={props.navigation}
              t={t}
              theme={theme}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function ReportContent(props: {
  timeline: ReportTimeline | null | undefined;
  loading: boolean;
  error: boolean;
  taskId: string;
  compact: boolean;
  onBack(): void;
  now: number;
  navigation: PluginSurfaceProps["navigation"];
  t: ReportsStrings;
  theme: Theme;
}) {
  const { t, theme, timeline } = props;
  const c = theme.colors;
  const [open, setOpen] = useState(() => new Set<string>());
  const [inner, setInner] = useState(() => new Set<string>());
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  useEffect(() => {
    setOpen(new Set());
    setInner(new Set());
    setDescriptionOpen(false);
  }, [props.taskId]);
  const flip = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };

  const back = props.compact ? (
    <Pressable
      accessibilityRole="button"
      onPress={props.onBack}
      style={styles.back}
    >
      <Icon name="ChevronLeft" size={16} color={c.accent} />
      <Text style={[styles.buttonText, { color: c.accent }]}>{t.back}</Text>
    </Pressable>
  ) : null;

  if (!timeline) {
    return (
      <View style={styles.content}>
        {back}
        <View style={styles.center}>
          <Text
            style={[
              styles.body,
              { color: props.error ? c.statusDanger : c.foregroundMuted },
            ]}
          >
            {props.error
              ? t.loadFailed
              : props.loading
                ? t.loading
                : t.noTimeline}
          </Text>
        </View>
      </View>
    );
  }
  const { task } = timeline;
  const newestReportId = newestReportOwner(timeline);
  const { excerpt, truncated } = descriptionExcerpt(task.description);
  return (
    <View style={styles.content}>
      {back}
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.title, { color: c.foreground }]} selectable>
          {task.title}
        </Text>
        <Text style={[styles.meta, { color: c.foregroundMuted }]}>
          <Text style={{ color: projectColor(task.projectName, theme) }}>
            {task.projectName}
          </Text>
          {" · "}
          {task.column ?? t.removedFromBoard}
        </Text>
        {task.description.trim() ? (
          <View
            style={[
              styles.card,
              { borderColor: c.border, backgroundColor: c.surface1 },
            ]}
          >
            <Text style={[styles.meta, { color: c.foregroundMuted }]}>
              {t.asked}
            </Text>
            {descriptionOpen ? (
              <RichText
                text={task.description}
                color={c.foreground}
                theme={theme}
              />
            ) : (
              <Text selectable style={[styles.body, { color: c.foreground }]}>
                {excerpt}
              </Text>
            )}
            {truncated ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: descriptionOpen }}
                onPress={() => setDescriptionOpen((v) => !v)}
              >
                <Text style={[styles.buttonText, { color: c.accent }]}>
                  {descriptionOpen ? t.showLess : t.showMore}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View style={styles.timeline}>
          {timeline.items.length === 0 ? (
            <Text style={[styles.body, { color: c.foregroundMuted }]}>
              {t.noTimeline}
            </Text>
          ) : (
            timeline.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                newestReportId={newestReportId}
                taskId={props.taskId}
                open={open.has(item.id)}
                isInteractionOpen={(id) => inner.has(id)}
                onToggle={(id) => setOpen((s) => flip(s, id))}
                onToggleInteraction={(id) => setInner((s) => flip(s, id))}
                now={props.now}
                navigation={props.navigation}
                t={t}
                theme={theme}
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, minWidth: 0 },
  scroll: { padding: 16, gap: 12 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: { fontSize: 18, fontWeight: "600" },
  meta: { fontSize: 11 },
  body: { fontSize: 13, lineHeight: 19 },
  mono: { fontSize: 12, fontFamily: "monospace" },
  label: { fontSize: 12, fontWeight: "600" },
  summary: { fontSize: 13, fontWeight: "500" },
  card: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  block: { gap: 4, marginTop: 4 },
  timeline: { gap: 6, marginTop: 4 },
  item: { borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  itemBody: { paddingHorizontal: 12, paddingBottom: 10, gap: 6 },
  inner: { borderLeftWidth: 2, paddingLeft: 10, gap: 6, marginLeft: 6 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  grow: { flex: 1, minWidth: 0 },
  badges: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: { fontSize: 10, fontWeight: "600" },
  button: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 4,
  },
  buttonText: { fontSize: 12, fontWeight: "600" },
});
