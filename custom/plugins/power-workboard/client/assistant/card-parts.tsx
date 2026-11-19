// CUSTOM(assistant-cards): the pieces the chat card and the report cards share, after jelly's
// "agents show, people react": a question with its options (gains, costs, the recommended one) the
// person answers in one tap, and the review map of what was asked with the evidence per item and a
// comment on any single item. Dumb on purpose: without a callback they only display.
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
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
 * A row's comment icon plus its inline field, for any row: `children` is the row's content, which
 * keeps the full width and gets the icon at its end. Without `onFeedback` it is just the content.
 */
export function Commentable({
  children,
  onFeedback,
  theme,
  labels,
}: {
  children: React.ReactNode;
  onFeedback?: (feedback: string) => Promise<void>;
  theme: Theme;
  labels: CardLabels;
}) {
  const [open, setOpen] = useState(false);
  if (!onFeedback) return <>{children}</>;
  return (
    <View style={styles.commentable}>
      <View style={styles.rowTop}>
        <View style={styles.grow}>{children}</View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.comment}
          hitSlop={8}
          onPress={() => setOpen((value) => !value)}
          style={styles.commentButton}
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

function OptionRow({
  option,
  recommended,
  picked,
  locked,
  busy,
  theme,
  labels,
  onPress,
}: {
  option: CardOption;
  recommended: boolean;
  picked: boolean;
  locked: boolean;
  busy: boolean;
  theme: Theme;
  labels: CardLabels;
  onPress?: () => void;
}) {
  const c = theme.colors;
  const disabled = locked || busy;
  const content = (
    <>
      <View style={styles.optionHead}>
        <Text
          selectable={!onPress}
          style={[styles.optionLabel, styles.grow, { color: c.foreground }]}
        >
          {option.label}
        </Text>
        {recommended ? (
          <View
            style={[
              styles.pill,
              { borderColor: c.accent, backgroundColor: wash(c.accent) },
            ]}
          >
            <Text style={[styles.pillText, { color: c.accent }]}>
              {labels.recommended}
            </Text>
          </View>
        ) : null}
        {picked ? (
          <View style={styles.sentRow}>
            <Icon name="Check" size={12} color={c.statusSuccess} />
            <Text style={[styles.small, { color: c.statusSuccess }]}>
              {labels.sent}
            </Text>
          </View>
        ) : busy ? (
          <Text style={[styles.small, { color: c.foregroundMuted }]}>
            {labels.sending}
          </Text>
        ) : null}
      </View>
      {option.gains ? (
        <Text style={[styles.small, { color: c.statusSuccess }]}>
          + {option.gains}
        </Text>
      ) : null}
      {option.costs ? (
        <Text style={[styles.small, { color: c.foregroundMuted }]}>
          − {option.costs}
        </Text>
      ) : null}
    </>
  );
  const style = [
    styles.option,
    {
      borderColor: recommended || picked ? c.accent : c.border,
      backgroundColor: c.surface0,
      opacity: disabled && !picked && !busy ? 0.55 : 1,
    },
  ];
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${labels.pick}: ${option.label}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={style}
    >
      {content}
    </Pressable>
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
}: {
  question: string;
  options: CardOption[];
  recommend?: string | null;
  why?: string | null;
  theme: Theme;
  labels: CardLabels;
  onPick?: (option: CardOption) => Promise<void>;
}) {
  const c = theme.colors;
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
  return (
    <View
      style={[
        styles.question,
        {
          borderColor: c.statusWarning,
          backgroundColor: wash(c.statusWarning),
        },
      ]}
    >
      {question ? (
        <View style={styles.rowTop}>
          <Icon name="CircleHelp" size={14} color={c.statusWarning} />
          <Text
            selectable
            style={[styles.questionText, styles.grow, { color: c.foreground }]}
          >
            {question}
          </Text>
        </View>
      ) : null}
      {options.length > 0 ? (
        <View style={styles.options}>
          {options.map((option) => (
            <OptionRow
              key={option.id}
              option={option}
              recommended={recommend === option.id}
              picked={pickedId === option.id}
              locked={pickedId !== null || sendingId !== null}
              busy={sendingId === option.id}
              theme={theme}
              labels={labels}
              onPress={onPick ? () => void pick(option) : undefined}
            />
          ))}
        </View>
      ) : null}
      {options.length > 0 && why ? (
        <Text style={[styles.small, { color: c.foregroundMuted }]}>
          {labels.why}: {why}
        </Text>
      ) : null}
      {error ? (
        <Text style={[styles.small, { color: c.statusDanger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const EVIDENCE_LOOK = {
  seen: { icon: "Eye" },
  tested: { icon: "FlaskConical" },
  unverified: { icon: "CircleHelp" },
} as const;

const NOT_DONE_ICON = {
  outside: "Shuffle",
  skipped: "SkipForward",
  unverified: "CircleHelp",
} as const;

/**
 * What the user asked, quoted, with the evidence per item; then what was skipped, not verified or
 * changed outside the ask. `onFeedback` adds a comment button on every row.
 */
export function OutcomeMap({
  outcomes,
  notDone,
  theme,
  labels,
  onFeedback,
}: {
  outcomes: CardOutcome[];
  notDone: CardNotDone[];
  theme: Theme;
  labels: CardLabels;
  onFeedback?: (itemText: string, feedback: string) => Promise<void>;
}) {
  const c = theme.colors;
  if (outcomes.length === 0 && notDone.length === 0) return null;
  const evidenceColor = {
    seen: c.statusSuccess,
    tested: c.accent,
    unverified: c.statusWarning,
  };
  return (
    <View style={styles.map}>
      {outcomes.length > 0 ? (
        <CardSectionTitle text={labels.whatYouAsked} theme={theme} />
      ) : null}
      {outcomes.map((outcome, index) => {
        const color = evidenceColor[outcome.evidence];
        return (
          <Commentable
            key={`o-${index}`}
            theme={theme}
            labels={labels}
            onFeedback={
              onFeedback
                ? (feedback) => onFeedback(outcome.text, feedback)
                : undefined
            }
          >
            <View style={styles.outcome}>
              <View style={styles.rowTop}>
                <View
                  style={[
                    styles.pill,
                    styles.evidence,
                    { borderColor: color, backgroundColor: wash(color) },
                  ]}
                >
                  <Icon
                    name={EVIDENCE_LOOK[outcome.evidence].icon}
                    size={11}
                    color={color}
                  />
                  <Text style={[styles.pillText, { color }]}>
                    {labels.evidence[outcome.evidence]}
                  </Text>
                </View>
                <Text
                  selectable
                  style={[styles.body, styles.grow, { color: c.foreground }]}
                >
                  “{outcome.text}”
                </Text>
              </View>
              {outcome.detail ? (
                <Text
                  selectable
                  style={[styles.detail, { color: c.foregroundMuted }]}
                >
                  {outcome.detail}
                </Text>
              ) : null}
            </View>
          </Commentable>
        );
      })}
      {notDone.map((item, index) => {
        const color =
          item.kind === "outside" ? c.statusWarning : c.foregroundMuted;
        return (
          <Commentable
            key={`n-${index}`}
            theme={theme}
            labels={labels}
            onFeedback={
              onFeedback
                ? (feedback) => onFeedback(item.text, feedback)
                : undefined
            }
          >
            <View style={styles.rowTop}>
              <View style={styles.notDoneLabel}>
                <Icon name={NOT_DONE_ICON[item.kind]} size={13} color={color} />
                <Text style={[styles.small, { color }]}>
                  {labels.notDoneKind[item.kind]}
                </Text>
              </View>
              <Text
                selectable
                style={[styles.body, styles.grow, { color: c.foreground }]}
              >
                {item.text}
              </Text>
            </View>
          </Commentable>
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
  question: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 8 },
  questionText: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
  options: { gap: 6 },
  option: { borderWidth: 1, borderRadius: 6, padding: 8, gap: 2 },
  optionHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  optionLabel: { fontSize: 13, lineHeight: 19, fontWeight: "600" },
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
  map: { gap: 8 },
  outcome: { gap: 3 },
  evidence: { marginTop: 2 },
  detail: { fontSize: 11, lineHeight: 16, fontFamily: "monospace" },
  notDoneLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 1,
  },
});
