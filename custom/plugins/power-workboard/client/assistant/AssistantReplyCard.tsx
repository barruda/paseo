// CUSTOM(assistant-reply-protocol): draws the `pwb` block the Projects Assistant ends its replies
// with (docs/assistant-reply-protocol.md) as icons, a `próximo` chip, the `seu` line and a details
// expander. The transformer only emits this item in the assistant's chat, so other agents' replies
// never reach it.
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import {
  DONE_FALLBACK_ICON,
  DONE_VERB_ICON,
  NEXT_LOOK,
  replyDetails,
  shortTaskId,
  splitReply,
  type ReplyItemData,
  type ReplyLine,
  type ReplySplit,
  type ReplyTone,
} from "../../shared/reply-protocol";
import { MarkdownText, wash } from "./TaskReportCard";
import { canOpenTaskReport, openTaskReport } from "./nav";

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
}: PluginTimelineItemProps<ReplyItemData>) {
  const text = item.data.text;
  const split = useMemo(() => splitReply(text), [text]);
  if (!split) return <MarkdownText text={text} theme={theme} />;
  return (
    <View style={styles.reply}>
      {split.before ? <MarkdownText text={split.before} theme={theme} /> : null}
      <ReplyCard split={split} theme={theme} layout={layout} />
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
  const style = [styles.body, styles.grow, strong && styles.strong, { color }];
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
      style={[styles.row, styles.grow]}
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
}: {
  icon: string;
  iconColor: string;
  line: ReplyLine;
  theme: Theme;
  label?: string;
  textColor?: string;
}) {
  return (
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
}

function ReplyCard({
  split,
  theme,
  layout,
}: {
  split: ReplySplit;
  theme: Theme;
  layout: Layout;
}) {
  const { reply } = split;
  const c = theme.colors;
  const details = replyDetails(split);
  const blocked = reply.blockers.length > 0;
  const yoursAction = reply.yours !== null && !reply.yours.none;
  const edge = blocked
    ? c.statusDanger
    : yoursAction
      ? c.statusWarning
      : c.border;
  const next = reply.next ? NEXT_LOOK[reply.next.value ?? "other"] : null;
  const nextColor = next ? toneColor(next.tone, theme) : c.foregroundMuted;

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
        />
      ))}
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

      {next || (reply.yours && reply.yours.none) ? (
        <View style={styles.footer}>
          {next && reply.next ? (
            <View
              style={[
                styles.chip,
                { borderColor: nextColor, backgroundColor: wash(nextColor) },
              ]}
              accessibilityLabel={`próximo: ${reply.next.text}`}
            >
              <Icon name={next.icon} size={13} color={nextColor} />
              <Text
                style={[styles.chipText, { color: nextColor }]}
                numberOfLines={1}
              >
                {reply.next.text}
              </Text>
            </View>
          ) : null}
          <View style={styles.grow} />
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
    paddingVertical: 10,
    gap: 6,
    marginVertical: 4,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  iconSlot: { width: 16, height: 20, justifyContent: "center" },
  grow: { flex: 1, minWidth: 0 },
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
