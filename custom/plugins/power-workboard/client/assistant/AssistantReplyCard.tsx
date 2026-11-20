// CUSTOM(assistant-reply-protocol): draws the `pwb` block the Project Manager ends its replies
// with (docs/assistant-reply-protocol.md) as icons, a `próximo` chip, the `seu` line and a details
// expander. The transformer only emits this item in the assistant's chat, so other agents' replies
// never reach it.
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useAgent,
  usePaseo,
  type PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import {
  DONE_FALLBACK_ICON,
  DONE_VERB_ICON,
  NEXT_LOOK,
  nextLegend,
  replyDetails,
  shortTaskId,
  splitReply,
  type NextValue,
  type ReplyItemData,
  type ReplyLine,
  type ReplySplit,
  type ReplyTone,
} from "../../shared/reply-protocol";
import { itemFeedback, optionAnswer } from "../../shared/card-answers";
import { usePaseoLocale } from "../paseo-language";
import { Commentable, OutcomeMap, QuestionBlock } from "./card-parts";
import { reportsStrings, type CardLabels } from "./reports-strings";
import { MarkdownText, wash } from "./TaskReportCard";
import { canOpenTaskReport, openTaskReport } from "./nav";
import { useIsNewestReply } from "./newest-reply"; // CUSTOM(assistant-cards)

type Theme = PluginTimelineItemProps["theme"];
type Layout = PluginTimelineItemProps["layout"];

/** How long the pointer rests on the details before they open, so passing over doesn't. */
const HOVER_OPEN_MS = 250;

function toneColor(tone: ReplyTone, theme: Theme): string {
  const c = theme.colors;
  if (tone === "success") return c.statusSuccess;
  if (tone === "warning") return c.statusWarning;
  if (tone === "danger") return c.statusDanger;
  if (tone === "info") return c.accent;
  return c.foregroundMuted;
}

export function AssistantReplyItem({
  item,
  theme,
  layout,
  agentId,
  timestamp,
}: PluginTimelineItemProps<ReplyItemData>) {
  const text = item.data.text;
  const split = useMemo(() => splitReply(text), [text]);
  if (!split) return <MarkdownText text={text} theme={theme} />;
  return (
    <View style={styles.reply}>
      {split.before ? <MarkdownText text={split.before} theme={theme} /> : null}
      <ReplyCard
        split={split}
        theme={theme}
        layout={layout}
        agentId={agentId}
        time={timestamp.getTime()}
      />
    </View>
  );
}

/** A line's text; with a task id it becomes a link to the ticket in the board's Reports tab. */
function LineText({
  line,
  color,
  theme,
  strong,
}: {
  line: ReplyLine;
  color: string;
  theme: Theme;
  strong?: boolean;
}) {
  const id = line.taskIds[0];
  const style = [
    styles.body,
    styles.shrink,
    strong && styles.strong,
    { color },
  ];
  if (!id || !canOpenTaskReport())
    return (
      <Text selectable style={style}>
        {line.text}
      </Text>
    );
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${line.text} (${shortTaskId(id)})`}
      onPress={() => openTaskReport(id)}
      style={[styles.row, styles.shrink]}
    >
      <Text style={[style, styles.link, { color: theme.colors.accent }]}>
        {line.text || shortTaskId(id)}
      </Text>
      <Icon name="ArrowUpRight" size={12} color={theme.colors.accent} />
    </Pressable>
  );
}

function IconLine({
  icon,
  iconColor,
  line,
  theme,
  label,
  textColor,
  onFeedback,
  labels,
}: {
  icon: string;
  iconColor: string;
  line: ReplyLine;
  theme: Theme;
  label?: string;
  textColor?: string;
  onFeedback?: (feedback: string) => Promise<void>;
  labels?: CardLabels;
}) {
  const row = (
    <View style={styles.rowTop}>
      <View style={styles.iconSlot}>
        <Icon name={icon} size={14} color={iconColor} />
      </View>
      {label ? (
        <Text style={[styles.verb, { color: theme.colors.foregroundMuted }]}>
          {label}
        </Text>
      ) : null}
      <LineText
        line={line}
        color={textColor ?? theme.colors.foreground}
        theme={theme}
      />
    </View>
  );
  if (!onFeedback || !labels) return row;
  return (
    <Commentable theme={theme} labels={labels} onFeedback={onFeedback} inline>
      {row}
    </Commentable>
  );
}

/**
 * The `próximo` chip and its legend. Hovering opens the legend on desktop web; keyboard focus and
 * a long press open it anywhere. The legend is a child of the hover View and starts at the chip's
 * bottom edge, so moving into it never leaves the hover target (docs/hover.md).
 */
function NextChip({
  next,
  theme,
  hoverable,
}: {
  next: { value: NextValue | null; text: string };
  theme: Theme;
  hoverable: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const look = NEXT_LOOK[next.value ?? "other"];
  const color = toneColor(look.tone, theme);
  const open = hovered || pinned;
  const c = theme.colors;
  return (
    <View
      style={styles.nextWrap}
      onPointerEnter={hoverable ? () => setHovered(true) : undefined}
      onPointerLeave={hoverable ? () => setHovered(false) : undefined}
    >
      <Pressable
        focusable
        accessibilityRole="button"
        accessibilityLabel={`próximo: ${next.text}`}
        accessibilityHint="mostra o que cada valor quer dizer"
        accessibilityState={{ expanded: open }}
        onFocus={() => setPinned(true)}
        onBlur={() => setPinned(false)}
        onLongPress={() => setPinned((value) => !value)}
        style={[
          styles.chip,
          { borderColor: color, backgroundColor: wash(color) },
        ]}
      >
        <Icon name={look.icon} size={13} color={color} />
        <Text style={[styles.chipText, { color }]} numberOfLines={1}>
          {next.text}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.legendWrap}>
          <View
            accessible
            accessibilityLabel="legenda do próximo"
            style={[
              styles.legend,
              { backgroundColor: c.surface2, borderColor: c.border },
            ]}
          >
            <Text style={[styles.legendTitle, { color: c.foregroundMuted }]}>
              quem move a seguir
            </Text>
            {nextLegend(next.value).map((entry) => {
              const rowColor = toneColor(entry.tone, theme);
              return (
                <View
                  key={entry.value}
                  accessibilityState={{ selected: entry.current }}
                  style={[
                    styles.legendRow,
                    entry.current && {
                      borderColor: rowColor,
                      backgroundColor: wash(rowColor),
                    },
                  ]}
                >
                  <Icon name={entry.icon} size={12} color={rowColor} />
                  <Text style={[styles.legendValue, { color: rowColor }]}>
                    {entry.value}
                  </Text>
                  <Text
                    style={[
                      styles.legendText,
                      {
                        color: entry.current ? c.foreground : c.foregroundMuted,
                      },
                      entry.current && styles.strong,
                    ]}
                  >
                    {entry.description}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ReplyCard({
  split,
  theme,
  layout,
  agentId,
  time,
}: {
  split: ReplySplit;
  theme: Theme;
  layout: Layout;
  agentId: string;
  time: number;
}) {
  const { reply } = split;
  const paseo = usePaseo();
  const labels = reportsStrings(usePaseoLocale()).card;
  // CUSTOM(assistant-cards): one-tap answers and item comments go to the chat as a message; a
  // failure shows on the card. Only the newest reply takes them, and not while the chat is
  // working (an answer was just sent), so an old answer is not sent again after a reload.
  const newest = useIsNewestReply(agentId, time);
  const running = useAgent(agentId, (agent) => agent.status === "running");
  const live = newest && running !== true;
  const say = (text: string) => paseo.agents.ref(agentId).send(text);
  const c = theme.colors;
  const details = replyDetails(split);
  const blocked = reply.blockers.length > 0;
  const yoursAction = reply.yours !== null && !reply.yours.none;
  const edge = blocked
    ? c.statusDanger
    : yoursAction
      ? c.statusWarning
      : c.border;
  const hasNext = reply.next !== null;
  const hasBody =
    reply.done.length +
      reply.outcomes.length +
      reply.notDone.length +
      reply.warnings.length +
      reply.blockers.length +
      reply.extra.length >
    0;

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: c.border,
          borderLeftColor: edge,
          backgroundColor: c.surface1,
        },
      ]}
    >
      {reply.done.map((line, index) => (
        <IconLine
          key={`done-${index}`}
          icon={line.verb ? DONE_VERB_ICON[line.verb] : DONE_FALLBACK_ICON}
          iconColor={c.statusSuccess}
          label={line.verb ?? undefined}
          line={line}
          theme={theme}
          labels={labels}
          onFeedback={
            live ? (text) => say(itemFeedback(line.text, text)) : undefined
          }
        />
      ))}
      <OutcomeMap
        outcomes={reply.outcomes}
        notDone={reply.notDone.map((line) => ({
          kind: line.kind,
          text: line.text,
        }))}
        theme={theme}
        labels={labels}
        onFeedback={
          live ? (item, text) => say(itemFeedback(item, text)) : undefined
        }
      />
      {reply.warnings.map((line, index) => (
        <IconLine
          key={`warn-${index}`}
          icon="TriangleAlert"
          iconColor={c.statusWarning}
          line={line}
          theme={theme}
        />
      ))}
      {reply.blockers.map((line, index) => (
        <IconLine
          key={`block-${index}`}
          icon="OctagonX"
          iconColor={c.statusDanger}
          line={line}
          theme={theme}
          textColor={c.statusDanger}
        />
      ))}
      {reply.extra.map((line, index) => (
        <IconLine
          key={`extra-${index}`}
          icon="Minus"
          iconColor={c.foregroundMuted}
          label={line.key ? `${line.key}:` : undefined}
          line={{ text: line.text, taskIds: [] }}
          theme={theme}
          textColor={c.foregroundMuted}
        />
      ))}

      {details ? (
        <Details
          markdown={details}
          initiallyOpen={blocked}
          hoverable={layout.platform === "web" && !layout.compact}
          theme={theme}
        />
      ) : null}

      {hasBody && (reply.question || hasNext || reply.yours) ? (
        <View style={[styles.divider, { borderColor: c.border }]} />
      ) : null}

      {reply.question ? (
        <QuestionBlock
          question={reply.question.text}
          options={reply.question.options}
          recommend={reply.question.recommend}
          why={reply.question.why}
          theme={theme}
          labels={labels}
          onPick={
            live
              ? (option) =>
                  say(optionAnswer(reply.question?.text ?? "", option))
              : undefined
          }
        />
      ) : null}

      {hasNext || (reply.yours && reply.yours.none) ? (
        <View style={styles.footer}>
          {reply.next ? (
            <NextChip
              next={reply.next}
              theme={theme}
              hoverable={layout.platform === "web" && !layout.compact}
            />
          ) : null}
          {reply.yours && reply.yours.none ? (
            <View
              style={[styles.seal, { borderColor: c.border }]}
              accessibilityLabel="seu: nada"
            >
              <Icon name="Check" size={12} color={c.foregroundMuted} />
              <Text style={[styles.sealText, { color: c.foregroundMuted }]}>
                seu: nada
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {reply.yours && !reply.yours.none ? (
        <View
          style={[
            styles.yours,
            {
              borderColor: c.statusWarning,
              backgroundColor: wash(c.statusWarning),
            },
          ]}
        >
          <View style={styles.iconSlot}>
            <Icon name="Hand" size={14} color={c.statusWarning} />
          </View>
          <Text style={[styles.yoursLabel, { color: c.statusWarning }]}>
            seu:
          </Text>
          <LineText
            line={reply.yours}
            color={c.foreground}
            theme={theme}
            strong
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The collapsed details. A click pins them open or closed; on desktop web, resting the pointer
 * on them opens them until it leaves. The hover target is a plain View that wraps both the toggle
 * and the content (docs/hover.md), so moving into the content keeps them open.
 */
function Details({
  markdown,
  initiallyOpen,
  hoverable,
  theme,
}: {
  markdown: string;
  initiallyOpen: boolean;
  hoverable: boolean;
  theme: Theme;
}) {
  const [pinned, setPinned] = useState(initiallyOpen);
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);
  const open = pinned || hovered;
  const c = theme.colors;

  const toggle = () => {
    clearTimer();
    setPinned(!open);
    setHovered(false);
  };

  return (
    <View
      style={styles.details}
      onPointerEnter={
        hoverable
          ? () => {
              clearTimer();
              timer.current = setTimeout(() => setHovered(true), HOVER_OPEN_MS);
            }
          : undefined
      }
      onPointerLeave={
        hoverable
          ? () => {
              clearTimer();
              setHovered(false);
            }
          : undefined
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="detalhes"
        onPress={toggle}
        style={styles.row}
      >
        <View style={styles.iconSlot}>
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={c.foregroundMuted}
          />
        </View>
        <Text style={[styles.detailsLabel, { color: c.foregroundMuted }]}>
          detalhes
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.detailsBody}>
          <MarkdownText text={markdown} theme={theme} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  reply: { gap: 8 },
  card: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    marginVertical: 4,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  iconSlot: { width: 16, height: 20, justifyContent: "center" },
  shrink: { flexShrink: 1, minWidth: 0 },
  body: { fontSize: 13, lineHeight: 20 },
  strong: { fontWeight: "600" },
  link: { textDecorationLine: "underline" },
  verb: { fontSize: 12, lineHeight: 20, fontWeight: "600" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  nextWrap: { position: "relative" },
  legendWrap: {
    position: "absolute",
    top: "100%",
    left: 0,
    paddingTop: 6,
    zIndex: 20,
  },
  legend: {
    width: 268,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    gap: 3,
    elevation: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  legendTitle: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  legendValue: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    minWidth: 52,
  },
  legendText: { fontSize: 12, lineHeight: 16, flexShrink: 1 },
  seal: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  sealText: { fontSize: 11 },
  yours: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  yoursLabel: { fontSize: 13, lineHeight: 20, fontWeight: "700" },
  details: { position: "relative" },
  detailsLabel: { fontSize: 12, fontWeight: "600" },
  detailsBody: { paddingLeft: 22, paddingTop: 4 },
});
