import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { copyText, Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { BtwTimelineData } from "../shared/btw";

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function statusLabel(data: BtwTimelineData): string {
  if (data.status === "asking") return "thinking…";
  if (data.status === "failed") return "failed";
  return data.durationMs === null ? "" : formatDuration(data.durationMs);
}

export function BtwCard({ item, theme }: PluginTimelineItemProps<BtwTimelineData>) {
  const data = item.data;
  const [expanded, setExpanded] = useState(true);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const copyAnswer = useCallback(() => {
    if (data.answer) void copyText(data.answer);
  }, [data.answer]);

  const styles = useMemo(
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
      status: {
        color: data.status === "failed" ? theme.colors.statusDanger : theme.colors.foregroundMuted,
        fontSize: 12,
      },
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
      actions: { flexDirection: "row" as const, justifyContent: "flex-end" as const },
      action: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" as const },
    }),
    [theme, data.status],
  );

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
        <Text style={styles.status}>{statusLabel(data)}</Text>
        <Icon
          name={expanded ? "ChevronDown" : "ChevronRight"}
          size={14}
          color={theme.colors.foregroundMuted}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          {data.status === "asking" ? (
            <Text style={styles.muted}>Asking a fork of this session…</Text>
          ) : null}
          {data.error ? (
            <Text style={styles.error} selectable>
              {data.error}
            </Text>
          ) : null}
          {data.answer ? (
            <>
              <Text style={styles.answer} selectable>
                {data.answer}
              </Text>
              <View style={styles.actions}>
                <Pressable onPress={copyAnswer} hitSlop={8}>
                  <Text style={styles.action}>Copy</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
