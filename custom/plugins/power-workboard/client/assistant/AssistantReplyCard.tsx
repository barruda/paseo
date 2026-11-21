// CUSTOM(assistant-reply-protocol): draws the `pwb` block the Project Manager ends its replies
// with (docs/assistant-reply-protocol.md) as icons, a `próximo` chip, the `seu` line and a details
// expander. The transformer only emits this item in the assistant's chat, so other agents' replies
// never reach it.
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useAgent,
  usePaseo,
  useRpc,
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
import {
  canOpenPmCard,
  canOpenTaskReport,
  openPmCard,
  openTaskReport,
} from "./nav"; // CUSTOM(pm-board)
import { useIsNewestReply } from "./newest-reply"; // CUSTOM(assistant-cards)
// CUSTOM(pm-chat-sync)
import { assistantPmDecideRpc } from "../../shared/assistant-rpc";
import {
  chatCanDecide,
  chatPickDecideInput,
  decidedTimeLabel,
  replyCardView,
  replyPmCardId,
  type ReplyCardView,
} from "../../shared/reply-card-sync";
import type { CardOption } from "./card-parts";
import { usePmCards, useRefreshPmCards } from "./pm-board/pm-cards-query";

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
  host,
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
        hostId={host.id}
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
  const style = [
    styles.body,
    styles.shrink,
    strong && styles.strong,
    { color },
  ];
  // CUSTOM(pm-board): a `[pm:<id>]` opens the decision card; a bare `[id]` opens the task.
  const pmCardId = line.pmCardIds[0];
  if (pmCardId && canOpenPmCard())
    return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${line.text} (${pmCardId})`}
        onPress={() => openPmCard(pmCardId)}
        style={[styles.row, styles.shrink]}
      >
        <Text style={[style, styles.link, { color: theme.colors.accent }]}>
          {line.text || pmCardId}
        </Text>
        <Icon name="ArrowUpRight" size={12} color={theme.colors.accent} />
      </Pressable>
    );
  const id = line.taskIds[0];
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
  hostId,
}: {
  split: ReplySplit;
  theme: Theme;
  layout: Layout;
  agentId: string;
  time: number;
  hostId: string;
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
  // CUSTOM(pm-chat-sync): a block that cites a PM card follows the card's live state, from the
  // same poll the Decisões page uses; old replies in the history follow it too.
  const cardId = replyPmCardId(reply);
  const cards = usePmCards(hostId, cardId !== null);
  const refreshCards = useRefreshPmCards(hostId);
  const callDecide = useRpc(assistantPmDecideRpc);
  // A host that cannot answer the query draws the block as before (as if the card were gone).
  const view = replyCardView(
    cardId,
    cards.data?.cards ?? (cards.isError ? [] : undefined),
    reply.question?.options ?? [],
  );
  const settled = view.state === "decided" || view.state === "archived";
  const sayPick = (option: CardOption) =>
    say(optionAnswer(reply.question?.text ?? "", option));
  // A tap on a waiting card decides it through the board, which also tells the PM. A block whose
  // card has not loaded yet takes no taps, so a tap never skips the card.
  const pickOnCard = async (option: CardOption) => {
    if (view.state !== "pending") return;
    await callDecide(chatPickDecideInput(view.card, option));
    await refreshCards();
  };
  const onPick = cardId
    ? chatCanDecide(view)
      ? pickOnCard
      : view.state === "missing" && live
        ? sayPick
        : undefined
    : live
      ? sayPick
      : undefined;
  const details = replyDetails(split);
  const blocked = reply.blockers.length > 0;
  const yoursAction = reply.yours !== null && !reply.yours.none;
  const edge =
    view.state === "decided"
      ? c.statusSuccess
      : view.state === "archived"
        ? c.border
        : blocked
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
          line={{ text: line.text, taskIds: [], pmCardIds: [] }}
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
          key={view.state}
          question={reply.question.text}
          options={reply.question.options}
          recommend={reply.question.recommend}
          why={reply.question.why}
          theme={theme}
          labels={labels}
          onPick={onPick}
          resolved={
            view.state === "decided"
              ? { tone: "success", optionId: view.optionId }
              : view.state === "archived"
                ? { tone: "muted", optionId: null }
                : null
          }
        />
      ) : null}
      {settled && !yoursAction ? (
        <Resolution view={view} theme={theme} labels={labels} />
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
        <YoursBox
          line={reply.yours}
          view={view}
          theme={theme}
          labels={labels}
        />
      ) : null}
    </View>
  );
}

/**
 * CUSTOM(pm-chat-sync): the `seu` line. Amber while it waits for the user; green once its PM card
 * is decided, neutral once it is archived, each with who decided and when.
 */
function YoursBox({
  line,
  view,
  theme,
  labels,
}: {
  line: ReplyLine;
  view: ReplyCardView;
  theme: Theme;
  labels: CardLabels;
}) {
  const c = theme.colors;
  const decided = view.state === "decided";
  const archived = view.state === "archived";
  const tone = decided
    ? c.statusSuccess
    : archived
      ? c.foregroundMuted
      : c.statusWarning;
  return (
    <View
      style={[
        styles.yours,
        {
          borderColor: archived ? c.border : tone,
          backgroundColor: archived ? "transparent" : wash(tone),
        },
      ]}
    >
      <View style={styles.iconSlot}>
        <Icon
          name={decided ? "CircleCheckBig" : archived ? "Archive" : "Hand"}
          size={14}
          color={tone}
        />
      </View>
      <View style={[styles.yoursBody, styles.shrink]}>
        <View style={styles.rowTop}>
          <Text style={[styles.yoursLabel, { color: tone }]}>seu:</Text>
          <LineText
            line={line}
            color={decided || archived ? c.foregroundMuted : c.foreground}
            theme={theme}
            strong={!decided && !archived}
          />
        </View>
        {decided || archived ? (
          <Resolution view={view} theme={theme} labels={labels} bare />
        ) : null}
      </View>
    </View>
  );
}

/** "decidido por você em 14:32", the decision when no option shows it, or "arquivado". */
function Resolution({
  view,
  theme,
  labels,
  bare,
}: {
  view: ReplyCardView;
  theme: Theme;
  labels: CardLabels;
  bare?: boolean;
}) {
  const c = theme.colors;
  if (view.state !== "decided" && view.state !== "archived") return null;
  const decided = view.state === "decided";
  const color = decided ? c.statusSuccess : c.foregroundMuted;
  let text = labels.archived;
  if (decided) {
    const who =
      view.by === "user"
        ? labels.decidedByYou
        : view.by === "pm"
          ? labels.decidedByPm
          : labels.decided;
    const time = decidedTimeLabel(view.at, Date.now());
    text = time ? `${who} ${labels.at} ${time}` : who;
  }
  const detail =
    decided && view.optionId === null && view.text ? view.text : null;
  return (
    <View
      accessibilityLabel={detail ? `${text}: ${detail}` : text}
      style={[styles.resolution, !bare && styles.resolutionRow]}
    >
      {bare ? null : (
        <Icon
          name={decided ? "CircleCheckBig" : "Archive"}
          size={13}
          color={color}
        />
      )}
      <Text style={[styles.resolutionText, styles.shrink, { color }]}>
        {text}
        {detail ? (
          <Text style={{ color: c.foregroundMuted }}>{`: ${detail}`}</Text>
        ) : null}
      </Text>
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
  yoursBody: { flexGrow: 1, gap: 2 },
  resolution: { flexDirection: "row", alignItems: "center", gap: 6 },
  resolutionRow: { marginTop: 2 },
  resolutionText: { fontSize: 12, lineHeight: 18, fontWeight: "600" },
  details: { position: "relative" },
  detailsLabel: { fontSize: 12, fontWeight: "600" },
  detailsBody: { paddingLeft: 22, paddingTop: 4 },
});
