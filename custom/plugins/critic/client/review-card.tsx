import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { CriticReviewData } from "@getpaseo/protocol/critic";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

type Theme = PluginTimelineItemProps["theme"];
type Tone = "muted" | "success" | "warning" | "danger";

interface Look {
  icon: string;
  tone: Tone;
  title: string;
  /** Open by default: the user should read the feedback. */
  open: boolean;
}

function roundLabel(data: CriticReviewData): string {
  return `round ${data.round}/${data.maxRounds}`;
}

export function reviewLook(data: CriticReviewData): Look {
  switch (data.status) {
    case "reviewing":
      return {
        icon: "ScanEye",
        tone: "muted",
        title: "Critic is reviewing the answer…",
        open: false,
      };
    case "approved":
      return { icon: "CircleCheck", tone: "success", title: "Critic approved", open: false };
    case "rejected":
      return {
        icon: "CircleX",
        tone: "muted",
        title: "Critic rejected the answer and sent it back",
        open: false,
      };
    case "limit":
      return {
        icon: "TriangleAlert",
        tone: "warning",
        title: "Critic still rejects it on the last round; the answer is shown as is",
        open: true,
      };
    case "question":
      return {
        icon: "MessageCircleQuestion",
        tone: "muted",
        title: "Agent asks you something",
        open: false,
      };
    case "waiting":
      return {
        icon: "Hourglass",
        tone: "muted",
        title: "Agent is waiting on background work",
        open: false,
      };
    case "failed":
      return { icon: "TriangleAlert", tone: "danger", title: "Critic failed", open: true };
    case "canceled":
      return {
        icon: "CircleSlash",
        tone: "muted",
        title: "Critic stopped: a new message arrived or the critic was turned off",
        open: false,
      };
  }
}

function toneColor(theme: Theme, tone: Tone): string {
  if (tone === "success") return theme.colors.statusSuccess;
  if (tone === "warning") return theme.colors.statusWarning;
  if (tone === "danger") return theme.colors.statusDanger;
  return theme.colors.foregroundMuted;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`;
}

function useStyles(theme: Theme) {
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
        paddingVertical: 7,
      },
      title: { flex: 1, color: theme.colors.foreground, fontSize: 13 },
      meta: { color: theme.colors.foregroundMuted, fontSize: 12 },
      body: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        paddingHorizontal: 10,
        paddingVertical: 8,
        gap: 6,
      },
      label: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        fontWeight: "600" as const,
        textTransform: "uppercase" as const,
        letterSpacing: 0.5,
        marginTop: 4,
      },
      error: { color: theme.colors.statusDanger, fontSize: 12 },
    }),
    [theme],
  );
}

export function CriticReviewCard({ item, theme }: PluginTimelineItemProps<CriticReviewData>) {
  const data = item.data;
  const look = reviewLook(data);
  const styles = useStyles(theme);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? look.open;
  const toggle = useCallback(() => setExpanded(!open), [open]);
  // The approved answer is already in the chat; a rejected one only lives here.
  const showAnswer = data.status === "rejected" || data.status === "failed";
  const hasBody = Boolean(data.feedback || data.error || (showAnswer && data.answer));
  const meta = [
    roundLabel(data),
    data.model,
    data.durationMs === null ? null : formatDuration(data.durationMs),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.card}>
      <Pressable
        onPress={hasBody ? toggle : undefined}
        accessibilityRole="button"
        accessibilityLabel={look.title}
        style={styles.header}
      >
        <Icon name={look.icon} size={14} color={toneColor(theme, look.tone)} />
        <Text style={styles.title} numberOfLines={1}>
          {look.title}
        </Text>
        <Text style={styles.meta}>{meta}</Text>
        {hasBody ? (
          <Icon
            name={open ? "ChevronUp" : "ChevronDown"}
            size={14}
            color={theme.colors.foregroundMuted}
          />
        ) : null}
      </Pressable>
      {open && hasBody ? (
        <View style={styles.body}>
          {data.error ? (
            <Text style={styles.error} selectable>
              {data.error}
            </Text>
          ) : null}
          {data.feedback ? (
            <>
              <Text style={styles.label}>Critic</Text>
              <Markdown>{data.feedback}</Markdown>
            </>
          ) : null}
          {showAnswer && data.answer ? (
            <>
              <Text style={styles.label}>Answer it reviewed</Text>
              <Markdown>{data.answer}</Markdown>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
