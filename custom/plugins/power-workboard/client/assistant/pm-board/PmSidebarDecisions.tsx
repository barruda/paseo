// CUSTOM(pm-sidebar-decisions): the PM chat sidebar's "Decisions" view, a compact scrollable list
// of the board's open decisions, and the badge with how many wait for the user. Both render inside
// the plugin's installation providers, so they share the chat reply cards' query: a decision made
// here turns the chat block green at once.
import { useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PmCard } from "../../../shared/pm-board";
import { usePaseoLocale } from "../../paseo-language";
import { openBoardSelection } from "../nav";
import { OptionTiles } from "../card-parts";
import { pmAge, pmBoardStrings, type PmBoardStrings } from "./pm-board-strings";
import { kindColor, usePmDecide, type PmDecideInput } from "./pm-card-shared";
import { usePmCards, useRefreshPmCards } from "./pm-cards-query";
import {
  pmCardImage,
  pmCardSummary,
  pmOpenDecisionCount,
  pmOpenDecisions,
} from "./pm-sidebar-list";

type HostProps = Pick<PluginSurfaceProps, "theme" | "host" | "layout">;
type Theme = PluginSurfaceProps["theme"];

const STICK_DISTANCE = 24;

export function PmSidebarDecisionsView(props: HostProps & { close?(): void }) {
  const t = pmBoardStrings(usePaseoLocale());
  const { theme } = props;
  const c = theme.colors;
  const cards = usePmCards(props.host.id);
  const refresh = useRefreshPmCards(props.host.id);
  const [pending, setPending] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [warning, setWarning] = useState<string | null>(null);
  const decide = usePmDecide({
    onSuccess: (result) => {
      setPending(null);
      setDrafts((current) => ({ ...current, [result.card.id]: "" }));
      setWarning(result.messageId ? null : t.notSent);
      void refresh();
    },
    onError: () => setPending(null),
  });
  const list = pmOpenDecisions(cards.data?.cards ?? []);

  // Opens at the end, like a chat, and stays there while the user is near the end.
  const scroller = useRef<{
    scrollToEnd(options?: { animated?: boolean }): void;
  }>(null);
  const stuck = useRef(true);

  const answer = (card: PmCard, input: Omit<PmDecideInput, "cardId">) => {
    setPending(card.id);
    decide.mutate({ cardId: card.id, ...input });
  };
  const selectTasks = (card: PmCard) => {
    setPending(card.id);
    decide.mutate(
      { cardId: card.id, answer: t.selectTickets },
      { onSuccess: () => openBoardSelection(card.links.taskIds) },
    );
  };
  const error = decide.error;
  const now = Date.now();

  return (
    <View style={[styles.page, { backgroundColor: c.surface0 }]}>
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
      <ScrollView
        ref={scroller as never}
        contentContainerStyle={styles.scroll}
        scrollEventThrottle={100}
        onScroll={(event: {
          nativeEvent: {
            contentOffset: { y: number };
            contentSize: { height: number };
            layoutMeasurement: { height: number };
          };
        }) => {
          // Wheel and drag alike: near the end it sticks there, scrolled up it stays put.
          const { contentOffset, contentSize, layoutMeasurement } =
            event.nativeEvent;
          stuck.current =
            contentSize.height - layoutMeasurement.height - contentOffset.y <
            STICK_DISTANCE;
        }}
        onContentSizeChange={() => {
          if (stuck.current) scroller.current?.scrollToEnd({ animated: false });
        }}
      >
        {list.length === 0 && !cards.isLoading && !cards.isError ? (
          <Text style={[styles.empty, { color: c.foregroundMuted }]}>
            {t.sidebarEmpty}
          </Text>
        ) : null}
        {list.map((card) => (
          <CompactCard
            key={card.id}
            card={card}
            theme={theme}
            t={t}
            now={now}
            busy={pending === card.id}
            draft={drafts[card.id] ?? ""}
            onDraft={(text) =>
              setDrafts((current) => ({ ...current, [card.id]: text }))
            }
            onAnswer={answer}
            onSelectTasks={selectTasks}
          />
        ))}
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
      </ScrollView>
    </View>
  );
}

/** The number of cards waiting for the user; nothing while loading or at zero. */
export function PmSidebarDecisionsBadge(props: HostProps) {
  const cards = usePmCards(props.host.id);
  if (!cards.data) return null;
  const count = pmOpenDecisionCount(cards.data.cards);
  if (count === 0) return null;
  const c = props.theme.colors;
  return (
    <View style={[styles.badge, { backgroundColor: c.surface2 }]}>
      <Text style={[styles.badgeText, { color: c.accent }]}>{count}</Text>
    </View>
  );
}

function CompactCard({
  card,
  theme,
  t,
  now,
  busy,
  draft,
  onDraft,
  onAnswer,
  onSelectTasks,
}: {
  card: PmCard;
  theme: Theme;
  t: PmBoardStrings;
  now: number;
  busy: boolean;
  draft: string;
  onDraft(text: string): void;
  onAnswer(card: PmCard, input: Omit<PmDecideInput, "cardId">): void;
  onSelectTasks(card: PmCard): void;
}) {
  const c = theme.colors;
  const waiting = card.status === "waiting";
  const image = pmCardImage(card);
  const summary = pmCardSummary(card);
  const selectTasks = waiting && card.action === "select-tasks";
  const hasOptions = waiting && !selectTasks && card.options.length > 0;
  return (
    <View
      style={[
        styles.card,
        { borderColor: c.border, backgroundColor: c.surface1 },
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
      {image ? (
        <Image
          source={{ uri: image }}
          resizeMode="cover"
          style={styles.image}
        />
      ) : null}
      <Text numberOfLines={2} style={[styles.title, { color: c.foreground }]}>
        {card.title}
      </Text>
      {summary ? (
        <Text
          numberOfLines={2}
          style={[styles.summary, { color: c.foregroundMuted }]}
        >
          {summary}
        </Text>
      ) : null}
      {selectTasks ? (
        <View style={styles.options}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => onSelectTasks(card)}
            style={({ pressed }) => [
              styles.option,
              {
                borderColor: c.accent,
                backgroundColor: c.surface1,
                opacity: busy ? 0.6 : pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={[styles.optionLabel, { color: c.accent }]}>
              {t.selectTickets}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => onAnswer(card, { answer: t.ignoreSuggestion })}
            style={({ pressed }) => [
              styles.option,
              {
                borderColor: c.border,
                opacity: busy ? 0.6 : pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={[styles.optionLabel, { color: c.foreground }]}>
              {t.ignoreSuggestion}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {hasOptions ? (
        <OptionTiles
          options={card.options}
          recommend={card.recommend}
          disabled={busy}
          onPick={(option) => onAnswer(card, { optionId: option.id })}
          theme={theme}
          labels={{
            recommended: t.recommended,
            sending: t.sending,
            chosen: "",
          }}
        />
      ) : null}
      {waiting && !selectTasks && !hasOptions ? (
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
            <Text style={{ color: c.accent, fontSize: 12 }}>
              {busy ? t.sending : t.send}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  scroll: { padding: 8, gap: 8 },
  notice: { paddingHorizontal: 8, paddingTop: 6, fontSize: 12 },
  empty: { fontSize: 12, textAlign: "center", paddingVertical: 16 },
  retry: { alignItems: "center", paddingVertical: 8 },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 6,
    minWidth: 18,
    alignItems: "center",
  },
  badgeText: { fontSize: 11, fontWeight: "600" },
  card: { borderWidth: 1, borderRadius: 8, padding: 8, gap: 6 },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  kind: { fontSize: 10, fontWeight: "600", textTransform: "uppercase" },
  meta: { fontSize: 11 },
  image: { width: "100%", height: 72, borderRadius: 6 },
  title: { fontSize: 13, fontWeight: "600" },
  summary: { fontSize: 12, lineHeight: 16 },
  options: { gap: 6 },
  option: { borderWidth: 1, borderRadius: 8, padding: 8 },
  optionLabel: { fontSize: 13, fontWeight: "500" },
  answerRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  input: {
    flex: 1,
    minHeight: 30,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
  },
  send: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    minHeight: 30,
    justifyContent: "center",
  },
});
