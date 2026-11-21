// CUSTOM(assistant-cards): the pieces the chat card and the report cards share, after jelly's
// "agents show, people react": a question with its options (gains, costs, the recommended one) the
// person answers in one tap, and the review map of what was asked with the evidence per item and a
// comment on any single item. Dumb on purpose: without a callback they only display.
// CUSTOM(pm-cards-look): the options are tiles and the review map a rail.
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { optionTileState } from "../../shared/option-tiles";
import type { CardLabels } from "./reports-strings";

type Theme = PluginTimelineItemProps["theme"];

export interface CardOption {
  id: string;
  label: string;
  gains?: string | null;
  costs?: string | null;
}

export interface CardOutcome {
  /** The user's ask, quoted. */
  text: string;
  evidence: "seen" | "tested" | "unverified";
  detail?: string | null;
}

export interface CardNotDone {
  kind: "skipped" | "unverified" | "outside";
  text: string;
}

/** A light wash of a `#rrggbb` color for backgrounds; other formats get none. */
export function wash(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}1f` : "transparent";
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Small uppercase section title. */
export function CardSectionTitle({
  text,
  theme,
}: {
  text: string;
  theme: Theme;
}) {
  return (
    <Text
      style={[styles.sectionTitle, { color: theme.colors.foregroundMuted }]}
    >
      {text}
    </Text>
  );
}

/**
 * The comment button of one item and, once opened, its inline field. `onSend` rejects with the
 * reason it failed; the field then stays open with that reason.
 */
export function ItemFeedback({
  open,
  onClose,
  onSend,
  theme,
  labels,
}: {
  open: boolean;
  onClose(): void;
  onSend(text: string): Promise<void>;
  theme: Theme;
  labels: CardLabels;
}) {
  const c = theme.colors;
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!open && state !== "sent") return null;
  if (state === "sent") {
    return (
      <View style={styles.sentRow}>
        <Icon name="Check" size={12} color={c.statusSuccess} />
        <Text style={[styles.small, { color: c.statusSuccess }]}>
          {labels.sent}
        </Text>
      </View>
    );
  }
  const busy = state === "sending";
  const send = async () => {
    if (!text.trim() || busy) return;
    setState("sending");
    setError(null);
    try {
      await onSend(text.trim());
      setState("sent");
      setText("");
      onClose();
    } catch (cause) {
      setError(errorText(cause, labels.sendFailed));
      setState("idle");
    }
  };
  return (
    <View style={styles.feedback}>
      <TextInput
        autoFocus
        multiline
        editable={!busy}
        accessibilityLabel={labels.comment}
        placeholder={labels.commentPlaceholder}
        placeholderTextColor={c.foregroundMuted}
        value={text}
        onChangeText={setText}
        style={[
          styles.input,
          {
            color: c.foreground,
            borderColor: c.border,
            backgroundColor: c.surface0,
          },
        ]}
      />
      {error ? (
        <Text style={[styles.small, { color: c.statusDanger }]}>{error}</Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.cancel}
          disabled={busy}
          onPress={() => {
            setText("");
            setError(null);
            onClose();
          }}
          style={[styles.smallButton, { borderColor: c.border }]}
        >
          <Text style={[styles.small, { color: c.foreground }]}>
            {labels.cancel}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.send}
          disabled={busy || !text.trim()}
          onPress={() => void send()}
          style={[
            styles.smallButton,
            {
              borderColor: c.accent,
              backgroundColor: c.accent,
              opacity: busy || !text.trim() ? 0.5 : 1,
            },
          ]}
        >
          <Text style={[styles.small, { color: c.accentForeground }]}>
            {busy ? labels.sending : labels.send}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * A row's comment icon plus its inline field, for any row. `children` is the row's content; by
 * default it fills the width and the icon sits at its end, and with `inline` the content shrinks
 * to its text and the icon follows it. Without `onFeedback` it is just the content.
 */
export function Commentable({
  children,
  onFeedback,
  theme,
  labels,
  inline = false,
  hoverable = false,
}: {
  children: React.ReactNode;
  onFeedback?: (feedback: string) => Promise<void>;
  theme: Theme;
  labels: CardLabels;
  /** Put the comment button right after the content instead of at the row's far right. */
  inline?: boolean;
  /**
   * CUSTOM(pm-cards-look): hide the button (opacity, so nothing moves) until the pointer is over
   * the row, it has keyboard focus or its field is open. Off: always visible.
   */
  hoverable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  if (!onFeedback) return <>{children}</>;
  const show = !hoverable || hovered || focused || open;
  return (
    <View
      style={styles.commentable}
      onPointerEnter={hoverable ? () => setHovered(true) : undefined}
      onPointerLeave={hoverable ? () => setHovered(false) : undefined}
    >
      <View style={styles.rowTop}>
        <View style={inline ? styles.shrink : styles.grow}>{children}</View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.comment}
          hitSlop={8}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPress={() => setOpen((value) => !value)}
          style={[
            styles.commentButton,
            { opacity: show ? 1 : 0 },
            !show && styles.noPointer,
          ]}
        >
          <Icon
            name="MessageSquarePlus"
            size={14}
            color={theme.colors.foregroundMuted}
          />
        </Pressable>
      </View>
      <ItemFeedback
        open={open}
        onClose={() => setOpen(false)}
        onSend={onFeedback}
        theme={theme}
        labels={labels}
      />
    </View>
  );
}

/** The few labels the option tiles need; the PM board fills them from its own strings. */
export interface OptionTileLabels {
  recommended: string;
  sending: string;
  chosen: string;
  /** Prefix of the accessibility label ("Answer with this option"); the label alone when empty. */
  pick?: string;
}

/**
 * CUSTOM(pm-cards-look): "Blocos". The options of a question as tiles in a wrapping row: the id, the
 * label, `+ gains` and `− costs`. The recommended one has the accent frame and a tag, the chosen
 * one is green with a check and the others fade. Used by the chat card and the PM board.
 * `onPick` absent means a display only (archived, or nobody can answer).
 */
export function OptionTiles({
  options,
  recommend,
  resolved,
  pickedId,
  sendingId,
  disabled,
  onPick,
  pickedText,
  theme,
  labels,
}: {
  options: CardOption[];
  recommend?: string | null;
  resolved?: { optionId: string | null } | null;
  pickedId?: string | null;
  sendingId?: string | null;
  disabled?: boolean;
  onPick?: (option: CardOption) => void;
  /** What the chosen mark says; `labels.chosen` by default. */
  pickedText?: string;
  theme: Theme;
  labels: OptionTileLabels;
}) {
  const c = theme.colors;
  return (
    <View style={styles.tiles}>
      {options.map((option) => {
        const state = optionTileState({
          optionId: option.id,
          recommend,
          resolved,
          pickedId,
          sendingId,
          disabled,
        });
        const opacity = state.faded ? 0.4 : state.dimmed ? 0.55 : 1;
        const content = (
          <>
            <View style={styles.tileHead}>
              <Text style={[styles.tileId, { color: c.foregroundMuted }]}>
                {option.id.toUpperCase()}
              </Text>
              {state.picked ? (
                <View style={styles.sentRow}>
                  <Icon name="Check" size={12} color={c.statusSuccess} />
                  <Text style={[styles.small, { color: c.statusSuccess }]}>
                    {pickedText ?? labels.chosen}
                  </Text>
                </View>
              ) : state.busy ? (
                <Text style={[styles.small, { color: c.foregroundMuted }]}>
                  {labels.sending}
                </Text>
              ) : null}
            </View>
            <Text
              selectable={!onPick}
              style={[styles.tileLabel, { color: c.foreground }]}
            >
              {option.label}
            </Text>
            {option.gains || option.costs ? (
              <View style={styles.tileLines}>
                {option.gains ? (
                  <Text style={[styles.tileLine, { color: c.foregroundMuted }]}>
                    <Text style={{ color: c.statusSuccess }}>+ </Text>
                    {option.gains}
                  </Text>
                ) : null}
                {option.costs ? (
                  <Text style={[styles.tileLine, { color: c.foregroundMuted }]}>
                    <Text style={{ color: c.statusWarning }}>− </Text>
                    {option.costs}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {state.recommended ? (
              <View
                style={[
                  styles.pill,
                  styles.recTag,
                  { borderColor: c.accent, backgroundColor: wash(c.accent) },
                ]}
              >
                <Text style={[styles.pillText, { color: c.accent }]}>
                  {labels.recommended}
                </Text>
              </View>
            ) : null}
          </>
        );
        const frame = (hovered: boolean) => ({
          borderColor: state.picked
            ? c.statusSuccess
            : state.recommended
              ? c.accent
              : hovered && !state.locked
                ? c.foregroundMuted
                : c.border,
          backgroundColor: state.picked
            ? wash(c.statusSuccess)
            : state.recommended
              ? wash(c.accent)
              : c.surface0,
        });
        if (!onPick)
          return (
            <View
              key={option.id}
              style={[styles.tile, frame(false), { opacity }]}
            >
              {content}
            </View>
          );
        return (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityLabel={
              labels.pick ? `${labels.pick}: ${option.label}` : option.label
            }
            accessibilityState={{ disabled: state.locked }}
            disabled={state.locked}
            onPress={() => onPick(option)}
            style={(interaction) => [
              styles.tile,
              frame(Boolean((interaction as { hovered?: boolean }).hovered)),
              { opacity: interaction.pressed && !state.locked ? 0.8 : opacity },
            ]}
          >
            {content}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A question with its options. Without options only the question shows (the answer is free text,
 * as ever). With `onPick`, each option answers in one tap.
 */
export function QuestionBlock({
  question,
  options,
  recommend,
  why,
  theme,
  labels,
  onPick,
  resolved,
}: {
  question: string;
  options: CardOption[];
  recommend?: string | null;
  why?: string | null;
  theme: Theme;
  labels: CardLabels;
  onPick?: (option: CardOption) => Promise<void>;
  /**
   * CUSTOM(pm-chat-sync): the question is settled on the PM board. `success` draws it green with
   * the chosen option marked and the others faded; `muted` draws it neutral (archived). No taps.
   */
  resolved?: { tone: "success" | "muted"; optionId: string | null } | null;
}) {
  const c = theme.colors;
  const tone = resolved
    ? resolved.tone === "success"
      ? c.statusSuccess
      : c.foregroundMuted
    : c.statusWarning;
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = async (option: CardOption) => {
    if (!onPick || sendingId || pickedId) return;
    setSendingId(option.id);
    setError(null);
    try {
      await onPick(option);
      setPickedId(option.id);
    } catch (cause) {
      setError(errorText(cause, labels.sendFailed));
    } finally {
      setSendingId(null);
    }
  };
  const recommended = options.find((option) => option.id === recommend);
  return (
    <View style={styles.question}>
      {question ? (
        <View style={styles.rowTop}>
          <Icon
            name={
              resolved
                ? resolved.tone === "success"
                  ? "CircleCheckBig"
                  : "Archive"
                : "CircleHelp"
            }
            size={14}
            color={tone}
          />
          <Text
            selectable
            style={[styles.questionText, styles.grow, { color: c.foreground }]}
          >
            {question}
          </Text>
        </View>
      ) : null}
      {options.length > 0 ? (
        <OptionTiles
          options={options}
          recommend={recommend}
          resolved={resolved ? { optionId: resolved.optionId } : null}
          pickedId={pickedId}
          sendingId={sendingId}
          onPick={
            onPick && !resolved ? (option) => void pick(option) : undefined
          }
          pickedText={resolved ? labels.chosen : undefined}
          theme={theme}
          labels={labels}
        />
      ) : null}
      {options.length > 0 && why && !resolved && !pickedId ? (
        <Text style={[styles.small, { color: c.foregroundMuted }]}>
          {recommended ? (
            <>
              {labels.recommend}{" "}
              <Text style={[styles.strong, { color: c.foreground }]}>
                {recommended.label}
              </Text>
              : {why}.
            </>
          ) : (
            `${labels.why}: ${why}`
          )}
        </Text>
      ) : null}
      {error ? (
        <Text style={[styles.small, { color: c.statusDanger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

/**
 * CUSTOM(pm-cards-look): one row of the "Trilho" rail: a dot on the line, the text on one line with
 * a small word after it, and a comment button. The second line (`detail`) and the full text show
 * while the pointer is over the row (`hoverable`), while it has keyboard focus, or once tapped.
 * The hover target is a plain View around the row, the tap lives on an inner Pressable
 * (docs/hover.md), and the comment button hides with opacity so nothing moves.
 */
function RailRow({
  color,
  word,
  wordColor,
  text,
  detail,
  hoverable,
  onFeedback,
  theme,
  labels,
}: {
  color: string;
  word: string;
  wordColor: string;
  text: string;
  detail?: string | null;
  hoverable: boolean;
  onFeedback?: (feedback: string) => Promise<void>;
  theme: Theme;
  labels: CardLabels;
}) {
  const c = theme.colors;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const open = hovered || focused || tapped || commenting;
  const showComment = !hoverable || open;
  return (
    <View
      style={styles.railRow}
      onPointerEnter={hoverable ? () => setHovered(true) : undefined}
      onPointerLeave={hoverable ? () => setHovered(false) : undefined}
    >
      <View style={styles.railMain}>
        <View style={[styles.dotRing, { backgroundColor: c.surface1 }]}>
          <View
            style={[
              styles.dot,
              { backgroundColor: color, borderColor: wash(color) },
            ]}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setTapped((value) => !value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.grow}
        >
          <View style={styles.railLine}>
            <Text
              selectable={open}
              numberOfLines={open ? undefined : 1}
              style={[styles.body, styles.shrink, { color: c.foreground }]}
            >
              {text}
            </Text>
            <Text style={[styles.mono, { color: wordColor }]}>{word}</Text>
          </View>
          {open && detail ? (
            <Text
              selectable
              style={[styles.detail, { color: c.foregroundMuted }]}
            >
              {detail}
            </Text>
          ) : null}
        </Pressable>
        {onFeedback ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.comment}
            hitSlop={8}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onPress={() => setCommenting((value) => !value)}
            style={[
              styles.commentButton,
              { opacity: showComment ? 1 : 0 },
              !showComment && styles.noPointer,
            ]}
          >
            <Icon
              name="MessageSquarePlus"
              size={14}
              color={c.foregroundMuted}
            />
          </Pressable>
        ) : null}
      </View>
      {onFeedback ? (
        <ItemFeedback
          open={commenting}
          onClose={() => setCommenting(false)}
          onSend={onFeedback}
          theme={theme}
          labels={labels}
        />
      ) : null}
    </View>
  );
}

/**
 * What the user asked, quoted, with the evidence per item; then what was skipped, not verified or
 * changed outside the ask. `onFeedback` adds a comment button on every row.
 * CUSTOM(pm-cards-look): drawn as a rail ("Trilho"); `hoverable` reveals the proof and the
 * comment button on hover (desktop web), and a tap reveals the proof anywhere.
 */
export function OutcomeMap({
  outcomes,
  notDone,
  theme,
  labels,
  onFeedback,
  hoverable = false,
}: {
  outcomes: CardOutcome[];
  notDone: CardNotDone[];
  theme: Theme;
  labels: CardLabels;
  onFeedback?: (itemText: string, feedback: string) => Promise<void>;
  hoverable?: boolean;
}) {
  const c = theme.colors;
  if (outcomes.length === 0 && notDone.length === 0) return null;
  const evidenceColor = {
    seen: c.statusSuccess,
    tested: c.accent,
    unverified: c.statusWarning,
  };
  return (
    <View accessibilityLabel={labels.whatYouAsked} style={styles.rail}>
      <View
        style={[
          styles.railLineBar,
          { backgroundColor: c.foregroundMuted, opacity: 0.35 },
        ]}
      />
      {outcomes.map((outcome, index) => {
        const color = evidenceColor[outcome.evidence];
        return (
          <RailRow
            key={`o-${index}`}
            color={color}
            word={labels.evidence[outcome.evidence]}
            wordColor={color}
            text={`“${outcome.text}”`}
            detail={outcome.detail}
            hoverable={hoverable}
            theme={theme}
            labels={labels}
            onFeedback={
              onFeedback
                ? (feedback) => onFeedback(outcome.text, feedback)
                : undefined
            }
          />
        );
      })}
      {notDone.map((item, index) => {
        const color =
          item.kind === "outside" ? c.statusWarning : c.foregroundMuted;
        return (
          <RailRow
            key={`n-${index}`}
            color={color}
            word={labels.notDoneKind[item.kind]}
            wordColor={color}
            text={item.text}
            hoverable={hoverable}
            theme={theme}
            labels={labels}
            onFeedback={
              onFeedback
                ? (feedback) => onFeedback(item.text, feedback)
                : undefined
            }
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  body: { fontSize: 13, lineHeight: 19 },
  small: { fontSize: 12, lineHeight: 17 },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  sentRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  commentable: { gap: 6 },
  commentButton: { paddingTop: 3, paddingHorizontal: 2 },
  feedback: { gap: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    minHeight: 56,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  smallButton: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  question: { gap: 8 },
  questionText: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
  strong: { fontWeight: "700" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    position: "relative",
    flexGrow: 1,
    flexBasis: 160,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 11,
    paddingVertical: 11,
    paddingHorizontal: 12,
    gap: 6,
  },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  tileId: { fontSize: 11, lineHeight: 16, fontFamily: "monospace" },
  tileLabel: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
  tileLines: { gap: 2 },
  tileLine: { fontSize: 12, lineHeight: 17 },
  recTag: { position: "absolute", top: 9, right: 9 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  pillText: { fontSize: 11, fontWeight: "600" },
  rail: { position: "relative", paddingLeft: 3 },
  railLineBar: {
    position: "absolute",
    left: 10,
    top: 14,
    bottom: 14,
    width: 1,
  },
  railRow: { paddingVertical: 5 },
  railMain: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  railLine: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  dotRing: {
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 3,
  },
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1 },
  mono: { fontSize: 11, fontFamily: "monospace", flexShrink: 0 },
  noPointer: { pointerEvents: "none" },
  detail: { fontSize: 12, lineHeight: 17, marginTop: 2 },
});
