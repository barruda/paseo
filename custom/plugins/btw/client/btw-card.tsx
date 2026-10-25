import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import {
  AgentForkMenu,
  copyText,
  FollowUpComposer,
  type FollowUpComposerSubmission,
  Icon,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type BtwTimelineData,
  cardTurns,
  followUpBtwRpc,
  formatThread,
  isAsking,
} from "../shared/btw";

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function statusLabel(turn: Pick<BtwTimelineData, "status" | "durationMs">): string {
  if (turn.status === "asking") return "thinking…";
  if (turn.status === "failed") return "failed";
  return turn.durationMs === null ? "" : formatDuration(turn.durationMs);
}

function lastAnswer(data: BtwTimelineData): string | null {
  const answered = cardTurns(data).filter((turn) => turn.answer);
  return answered.at(-1)?.answer ?? null;
}

function useCardStyles(theme: PluginTimelineItemProps["theme"], compact: boolean) {
  return useMemo(
    () => ({
      card: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
      },
      tag: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        fontWeight: "600" as const,
        textTransform: "uppercase" as const,
        letterSpacing: 0.5,
      },
      question: { flex: 1, color: theme.colors.foreground, fontSize: 13 },
      status: { color: theme.colors.foregroundMuted, fontSize: 12 },
      failedStatus: { color: theme.colors.statusDanger, fontSize: 12 },
      body: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        paddingHorizontal: 10,
        paddingVertical: 8,
        gap: 6,
      },
      answer: { color: theme.colors.foreground, fontSize: 13, lineHeight: 19 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      error: { color: theme.colors.statusDanger, fontSize: 12 },
      followUp: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        marginTop: 4,
        paddingTop: 8,
        gap: 6,
      },
      followUpQuestion: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      followUpText: {
        flex: 1,
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      actions: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        marginTop: 2,
      },
      actionIcons: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
      // The copy icon sits 25px right of the TLDR and branch icons.
      copyGap: { width: 25 },
      iconButton: { padding: 4 },
      iconButtonDisabled: { padding: 4, opacity: 0.4 },
      followUpLink: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" as const },
      followUpLinkDisabled: {
        color: theme.colors.accent,
        fontSize: 12,
        fontWeight: "600" as const,
        opacity: 0.4,
      },
      composer: { width: compact ? ("100%" as const) : ("50%" as const), minWidth: 280 },
    }),
    [theme, compact],
  );
}

type CardStyles = ReturnType<typeof useCardStyles>;

function TurnAnswer({
  turn,
  styles,
}: {
  turn: Pick<BtwTimelineData, "status" | "answer" | "error">;
  styles: CardStyles;
}) {
  return (
    <>
      {turn.status === "asking" ? (
        <Text style={styles.muted}>Asking a fork of this session…</Text>
      ) : null}
      {turn.error ? (
        <Text style={styles.error} selectable>
          {turn.error}
        </Text>
      ) : null}
      {turn.answer ? (
        <Text style={styles.answer} selectable>
          {turn.answer}
        </Text>
      ) : null}
    </>
  );
}

function IconButton({
  icon,
  label,
  color,
  disabled,
  onPress,
  styles,
}: {
  icon: string;
  label: string;
  color: string;
  disabled?: boolean;
  onPress(): void;
  styles: CardStyles;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={disabled ? styles.iconButtonDisabled : styles.iconButton}
    >
      <Icon name={icon} size={14} color={color} />
    </Pressable>
  );
}

export function BtwCard({
  agentId,
  item,
  theme,
  host,
  layout,
}: PluginTimelineItemProps<BtwTimelineData>) {
  const data = item.data;
  const toast = useToast();
  const followUp = useRpc(followUpBtwRpc);
  const [expanded, setExpanded] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const styles = useCardStyles(theme, layout.compact);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const asking = isAsking(data);
  const answer = lastAnswer(data);
  const cardId = data.id;

  const ask = useCallback(
    (kind: "question" | "tldr", submission?: FollowUpComposerSubmission) => {
      if (!cardId) return;
      setComposerOpen(false);
      followUp({
        agentId,
        cardId,
        card: data,
        kind,
        question: submission?.text ?? "",
        files: submission?.files ?? [],
      }).catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error)),
      );
    },
    [agentId, cardId, data, followUp, toast],
  );
  const askTldr = useCallback(() => ask("tldr"), [ask]);
  const submitFollowUp = useCallback(
    (submission: FollowUpComposerSubmission) => ask("question", submission),
    [ask],
  );
  const copyAnswer = useCallback(() => {
    if (answer) void copyText(answer).then(() => toast.show("Copied"));
  }, [answer, toast]);
  const branchContext = useCallback(() => formatThread(data), [data]);
  const openComposer = useCallback(() => setComposerOpen((open) => !open), []);
  const closeComposer = useCallback(() => setComposerOpen(false), []);

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.header}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={`Side question ${data.question}, ${statusLabel(data)}`}
      >
        <Icon name="MessageCircleQuestionMark" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.tag}>btw</Text>
        <Text style={styles.question} numberOfLines={expanded ? undefined : 1}>
          {data.question}
        </Text>
        <Text style={data.status === "failed" ? styles.failedStatus : styles.status}>
          {statusLabel(data)}
        </Text>
        <Icon
          name={expanded ? "ChevronDown" : "ChevronRight"}
          size={14}
          color={theme.colors.foregroundMuted}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          <TurnAnswer turn={data} styles={styles} />
          {(data.followUps ?? []).map((turn) => (
            <View key={turn.askedAt} style={styles.followUp}>
              <View style={styles.followUpQuestion}>
                <Icon
                  name={turn.kind === "tldr" ? "ListCollapse" : "CornerDownRight"}
                  size={13}
                  color={theme.colors.foregroundMuted}
                />
                <Text style={styles.followUpText} selectable>
                  {turn.question}
                  {turn.fileNames.length > 0 ? (
                    <Text style={styles.muted}>{`  📎 ${turn.fileNames.join(", ")}`}</Text>
                  ) : null}
                </Text>
                <Text style={turn.status === "failed" ? styles.failedStatus : styles.status}>
                  {statusLabel(turn)}
                </Text>
              </View>
              <TurnAnswer turn={turn} styles={styles} />
            </View>
          ))}
          {answer && cardId ? (
            <View style={styles.actions}>
              <Pressable
                onPress={openComposer}
                disabled={asking}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={asking ? styles.followUpLinkDisabled : styles.followUpLink}>
                  Ask follow up
                </Text>
              </Pressable>
              <View style={styles.actionIcons}>
                <IconButton
                  icon="ListCollapse"
                  label="TLDR in this card"
                  color={theme.colors.foregroundMuted}
                  disabled={asking}
                  onPress={askTldr}
                  styles={styles}
                />
                <AgentForkMenu
                  serverId={host.id}
                  agentId={agentId}
                  extraContext={branchContext}
                  testID="btw-fork-menu"
                />
                <View style={styles.copyGap} />
                <IconButton
                  icon="Copy"
                  label="Copy answer"
                  color={theme.colors.foregroundMuted}
                  onPress={copyAnswer}
                  styles={styles}
                />
              </View>
            </View>
          ) : null}
          {composerOpen ? (
            <View style={styles.composer}>
              <FollowUpComposer
                serverId={host.id}
                agentId={agentId}
                placeholder="Ask a follow-up…"
                disabled={asking}
                onSubmit={submitFollowUp}
                onCancel={closeComposer}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
