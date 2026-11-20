// CUSTOM(pm-board): the Project Manager's own board. Investigations, proposals and decisions
// between the user and the PM, apart from the task board. The user answers a proposal on its card:
// the answer goes to the PM chat as a message and the card moves to Decided.
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import {
  assistantPmCardsRpc,
  assistantPmDecideRpc,
  assistantPmReopenRpc,
} from "../../../shared/assistant-rpc";
import {
  PM_CARD_STATUSES,
  type PmCard,
  type PmCardKind,
  type PmCardStatus,
} from "../../../shared/pm-board";
import { usePaseoLocale } from "../../paseo-language";
import { consumePmCardRequest, usePmCardRequest, showReport } from "../nav";
import { pmAge, pmBoardStrings, type PmBoardStrings } from "./pm-board-strings";

const COMPACT_WIDTH = 900;

type Props = PluginSurfaceProps;
type Theme = Props["theme"];

const statusOrder: readonly PmCardStatus[] = PM_CARD_STATUSES;

const byUpdate = (left: PmCard, right: PmCard) =>
  right.updatedAt.localeCompare(left.updatedAt);

export function PmBoardScreen(props: PluginSurfaceProps) {
  const t = pmBoardStrings(usePaseoLocale());
  const { theme } = props;
  const { width } = useWindowDimensions();
  const compact = props.layout.compact || width < COMPACT_WIDTH;
  const hostId = props.host.id;
  const callCards = useRpc(assistantPmCardsRpc);
  const callDecide = useRpc(assistantPmDecideRpc);
  const callReopen = useRpc(assistantPmReopenRpc);
  const cache = useQueryClient();
  const base = ["power-workboard", "pm-board", hostId] as const;
  const request = usePmCardRequest();
  const [pending, setPending] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [warning, setWarning] = useState<string | null>(null);

  const cards = useQuery({
    queryKey: base,
    queryFn: () => callCards({}),
    refetchInterval: 5_000,
  });

  const refresh = () => cache.invalidateQueries({ queryKey: base });
  const decide = useMutation({
    mutationFn: (input: {
      cardId: string;
      optionId?: string | null;
      answer?: string | null;
    }) => callDecide(input),
    onSuccess: (result) => {
      setPending(null);
      setDrafts((current) => ({ ...current, [result.card.id]: "" }));
      setWarning(result.messageId ? null : t.notSent);
      void refresh();
    },
    onError: () => setPending(null),
  });
  const reopen = useMutation({
    mutationFn: (cardId: string) => callReopen({ cardId }),
    onSuccess: (result) => {
      setPending(null);
      setWarning(result.messageId ? null : t.notSent);
      void refresh();
    },
    onError: () => setPending(null),
  });

  // A `[pm:<id>]` in the chat, or a link, asks for one card: scroll to its column is out of
  // scope, but the card is marked and its answer field is ready.
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    if (!request) return;
    setFocused(request.cardId);
    consumePmCardRequest(request.seq);
  }, [request]);

  const columns = useMemo(
    () =>
      statusOrder.map((status) => ({
        status,
        cards: (cards.data?.cards ?? [])
          .filter((card) => card.status === status)
          .sort(byUpdate),
      })),
    [cards.data],
  );

  const answer = (
    card: PmCard,
    input: { optionId?: string | null; answer?: string | null },
  ) => {
    setPending(card.id);
    decide.mutate({ cardId: card.id, ...input });
  };
  const reopenCard = (card: PmCard) => {
    setPending(card.id);
    reopen.mutate(card.id);
  };
  const openReport = (taskId: string) => {
    if (props.navigation) showReport(props.navigation, taskId);
  };

  const now = Date.now();
  const error = decide.error ?? reopen.error;
  const c = theme.colors;

  return (
    <View style={[styles.page, { backgroundColor: c.surface0 }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.foreground }]}>{t.title}</Text>
        <Text style={[styles.subtitle, { color: c.foregroundMuted }]}>
          {t.subtitle}
        </Text>
      </View>
      {warning ? (
        <Text style={[styles.notice, { color: c.statusWarning }]}>
          {warning}
        </Text>
      ) : null}
      {error ? (
        <Text style={[styles.notice, { color: c.statusDanger }]}>
          {error instanceof Error ? error.message : String(error)}
        </Text>
      ) : null}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View
          style={[
            styles.columns,
            compact ? styles.columnsCompact : styles.columnsWide,
          ]}
        >
          {columns.map((column) => (
            <View
              key={column.status}
              style={[
                styles.column,
                !compact && styles.columnWide,
                { borderColor: c.border, backgroundColor: c.surface1 },
              ]}
            >
              <View style={[styles.columnHead, { borderColor: c.border }]}>
                <Text style={[styles.columnTitle, { color: c.foreground }]}>
                  {t.columns[column.status]}
                </Text>
                <Text style={[styles.count, { color: c.foregroundMuted }]}>
                  {column.cards.length}
                </Text>
              </View>
              <View style={styles.columnBody}>
                {column.cards.length === 0 ? (
                  <Text style={[styles.empty, { color: c.foregroundMuted }]}>
                    {t.empty[column.status]}
                  </Text>
                ) : (
                  column.cards.map((card) => (
                    <CardView
                      key={card.id}
                      card={card}
                      theme={theme}
                      t={t}
                      now={now}
                      focused={focused === card.id}
                      busy={pending === card.id}
                      draft={drafts[card.id] ?? ""}
                      onDraft={(text) =>
                        setDrafts((current) => ({
                          ...current,
                          [card.id]: text,
                        }))
                      }
                      onAnswer={answer}
                      onReopen={reopenCard}
                      onOpenReport={openReport}
                    />
                  ))
                )}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      {cards.isLoading ? (
        <Text style={[styles.empty, { color: c.foregroundMuted }]}>
          {t.loading}
        </Text>
      ) : null}
      {cards.isError ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void cards.refetch()}
          style={styles.retry}
        >
          <Text style={{ color: c.accent }}>{t.retry}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const kindColor = (kind: PmCardKind, theme: Theme) =>
  kind === "decision"
    ? theme.colors.statusSuccess
    : kind === "proposal"
      ? theme.colors.accent
      : kind === "investigation"
        ? theme.colors.statusWarning
        : theme.colors.foregroundMuted;

function CardView({
  card,
  theme,
  t,
  now,
  focused,
  busy,
  draft,
  onDraft,
  onAnswer,
  onReopen,
  onOpenReport,
}: {
  card: PmCard;
  theme: Theme;
  t: PmBoardStrings;
  now: number;
  focused: boolean;
  busy: boolean;
  draft: string;
  onDraft(text: string): void;
  onAnswer(
    card: PmCard,
    input: { optionId?: string | null; answer?: string | null },
  ): void;
  onReopen(card: PmCard): void;
  onOpenReport(taskId: string): void;
}) {
  const c = theme.colors;
  const [expanded, setExpanded] = useState(false);
  const links = [...new Set([...card.links.taskIds, ...card.links.reportIds])];
  const waiting = card.status === "waiting";
  return (
    <View
      style={[
        styles.card,
        {
          borderColor: focused ? c.accent : c.border,
          backgroundColor: c.surface2,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <Text style={[styles.kind, { color: kindColor(card.kind, theme) }]}>
          {t.kinds[card.kind]}
        </Text>
        <Text style={[styles.meta, { color: c.foregroundMuted }]}>
          {pmAge(card.updatedAt, now, t.ago)}
        </Text>
      </View>
      <Text style={[styles.cardTitle, { color: c.foreground }]}>
        {card.title}
      </Text>
      {card.question ? (
        <Text style={[styles.body, { color: c.foreground }]}>
          {card.question}
        </Text>
      ) : null}
      {waiting && card.options.length > 0 ? (
        <View style={styles.options}>
          {card.options.map((option) => (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => onAnswer(card, { optionId: option.id })}
              style={({ pressed }) => [
                styles.option,
                {
                  borderColor: c.border,
                  opacity: busy ? 0.6 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <View style={styles.optionHead}>
                <Text style={[styles.optionLabel, { color: c.foreground }]}>
                  {option.label}
                </Text>
                {card.recommend === option.id ? (
                  <Text style={[styles.meta, { color: c.statusSuccess }]}>
                    {t.recommended}
                  </Text>
                ) : null}
              </View>
              {option.gains ? (
                <Text style={[styles.meta, { color: c.foregroundMuted }]}>
                  + {t.gains}: {option.gains}
                </Text>
              ) : null}
              {option.costs ? (
                <Text style={[styles.meta, { color: c.foregroundMuted }]}>
                  − {t.costs}: {option.costs}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {waiting ? (
        <View style={styles.answerRow}>
          <TextInput
            accessibilityLabel={t.send}
            value={draft}
            onChangeText={onDraft}
            editable={!busy}
            placeholder={t.answerPlaceholder}
            placeholderTextColor={c.foregroundMuted}
            style={[
              styles.input,
              { color: c.foreground, borderColor: c.border },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || !draft.trim()}
            onPress={() => onAnswer(card, { answer: draft })}
            style={[
              styles.send,
              {
                borderColor: c.accent,
                opacity: busy || !draft.trim() ? 0.5 : 1,
              },
            ]}
          >
            <Text style={{ color: c.accent }}>{busy ? t.sending : t.send}</Text>
          </Pressable>
        </View>
      ) : null}
      {card.findings ? (
        <Pressable onPress={() => setExpanded((value) => !value)}>
          <Text
            numberOfLines={expanded ? undefined : 4}
            style={[styles.body, { color: c.foregroundMuted }]}
          >
            {card.findings}
          </Text>
          <Text style={[styles.meta, { color: c.accent }]}>
            {expanded ? t.showLess : t.showMore}
          </Text>
        </Pressable>
      ) : null}
      {card.decision ? (
        <Text style={[styles.body, { color: c.foreground }]}>
          {`${t.decision}: ${card.decision}`}
        </Text>
      ) : null}
      {card.status === "decided" && card.decidedBy ? (
        <Text style={[styles.meta, { color: c.foregroundMuted }]}>
          {`${card.decidedBy === "user" ? t.decidedByUser : t.decidedByPm} · ${pmAge(card.decidedAt ?? card.updatedAt, now, t.ago)}`}
        </Text>
      ) : null}
      {links.length > 0 ? (
        <View style={styles.links}>
          {links.map((id) => (
            <Pressable
              key={id}
              accessibilityRole="link"
              onPress={() => onOpenReport(id)}
              style={[styles.link, { borderColor: c.border }]}
            >
              <Text style={{ color: c.accent }}>
                {`${t.openReport}: ${id.slice(0, 8)}`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {card.status === "decided" ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => onReopen(card)}
          style={[styles.reopen, { opacity: busy ? 0.5 : 1 }]}
        >
          <Text style={{ color: c.accent }}>
            {busy ? t.reopening : t.reopen}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 14, gap: 4 },
  title: { fontSize: 18, fontWeight: "600" },
  subtitle: { fontSize: 12, lineHeight: 17, maxWidth: 760 },
  notice: { paddingHorizontal: 16, paddingTop: 8, fontSize: 12 },
  scroll: { padding: 16 },
  columns: { gap: 12 },
  columnsWide: { flexDirection: "row", alignItems: "flex-start" },
  columnsCompact: { flexDirection: "column" },
  column: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  columnWide: { flex: 1, minWidth: 240 },
  columnHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  columnTitle: { fontSize: 13, fontWeight: "600" },
  count: { fontSize: 12 },
  columnBody: { padding: 10, gap: 10 },
  empty: { fontSize: 12, paddingVertical: 6 },
  card: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  kind: { fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  meta: { fontSize: 11, lineHeight: 15 },
  cardTitle: { fontSize: 14, fontWeight: "600" },
  body: { fontSize: 13, lineHeight: 18 },
  options: { gap: 6 },
  option: { borderWidth: 1, borderRadius: 8, padding: 8, gap: 3 },
  optionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  optionLabel: { fontSize: 13, fontWeight: "500", flexShrink: 1 },
  answerRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  input: {
    flex: 1,
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
  },
  send: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    minHeight: 34,
    justifyContent: "center",
  },
  links: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  link: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  reopen: { alignSelf: "flex-start", paddingVertical: 2 },
  retry: { paddingHorizontal: 16, paddingBottom: 16 },
});
