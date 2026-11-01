// CUSTOM(git-sync): the card "Check sync status between projects" posts in the chat, styled like the
// BTW card: a header with the verdict that folds the body, then both checkouts, the commits each
// side lacks, and a merge preview.
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type SyncReportData, type SyncTone, summarizeSync } from "../shared/shell-command";

type Theme = PluginTimelineItemProps["theme"];

function useCardStyles(theme: Theme) {
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
      time: { color: theme.colors.foregroundMuted, fontSize: 12 },
      body: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        paddingHorizontal: 10,
        paddingVertical: 8,
        gap: 10,
      },
      section: { gap: 3 },
      sectionTitle: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      row: { flexDirection: "row" as const, gap: 8 },
      label: { color: theme.colors.foregroundMuted, fontSize: 12, width: 92 },
      value: { flex: 1, color: theme.colors.foreground, fontSize: 12 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      sha: { color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: "monospace" },
      commit: { flex: 1, color: theme.colors.foreground, fontSize: 12 },
      hint: { color: theme.colors.foreground, fontSize: 12, lineHeight: 18 },
      hintSuccess: { color: theme.colors.statusSuccess, fontSize: 12, lineHeight: 18 },
      hintDanger: { color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 },
      sectionTitleWarning: {
        color: theme.colors.statusWarning,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      headlineTone: {
        success: { flex: 1, fontSize: 13, color: theme.colors.statusSuccess },
        warning: { flex: 1, fontSize: 13, color: theme.colors.statusWarning },
        danger: { flex: 1, fontSize: 13, color: theme.colors.statusDanger },
        muted: { flex: 1, fontSize: 13, color: theme.colors.foreground },
      } satisfies Record<SyncTone, object>,
    }),
    [theme],
  );
}

type CardStyles = ReturnType<typeof useCardStyles>;

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function SideRow({
  label,
  side,
  styles,
}: {
  label: string;
  side: NonNullable<SyncReportData["worktree"]>;
  styles: CardStyles;
}) {
  const extras: string[] = [];
  if (side.uncommitted) extras.push(`${side.uncommitted} uncommitted`);
  if (side.conflicts.length) extras.push(`${side.conflicts.length} in conflict`);
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>
        {side.branch ?? "(detached)"}
        <Text style={styles.muted}>{`  ${side.path}`}</Text>
        {extras.length ? <Text style={styles.muted}>{`  · ${extras.join(" · ")}`}</Text> : null}
      </Text>
    </View>
  );
}

function CommitList({
  title,
  commits,
  styles,
}: {
  title: string;
  commits: SyncReportData["toMain"];
  styles: CardStyles;
}) {
  if (commits.total === 0) return null;
  const more = commits.total - commits.commits.length;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{`${title} (${commits.total})`}</Text>
      {commits.commits.map((commit) => (
        <View key={commit.sha} style={styles.row}>
          <Text style={styles.sha} selectable>
            {commit.sha}
          </Text>
          <Text style={styles.commit} numberOfLines={1} selectable>
            {commit.subject}
          </Text>
        </View>
      ))}
      {more > 0 ? <Text style={styles.muted}>{`and ${more} more`}</Text> : null}
    </View>
  );
}

function MergePreview({ data, styles }: { data: SyncReportData; styles: CardStyles }) {
  if (data.toMain.total === 0 || data.fromMain.total === 0) return null;
  if (data.mergeConflicts === null) {
    return <Text style={styles.muted}>Merge preview unavailable.</Text>;
  }
  if (data.mergeConflicts.length === 0) {
    return <Text style={styles.hintSuccess}>Merge preview: the two sides merge cleanly.</Text>;
  }
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitleWarning}>
        {`Merge preview: ${data.mergeConflicts.length} file${data.mergeConflicts.length === 1 ? "" : "s"} would conflict`}
      </Text>
      {data.mergeConflicts.slice(0, 12).map((file) => (
        <Text key={file} style={styles.value} selectable>
          {file}
        </Text>
      ))}
      {data.mergeConflicts.length > 12 ? (
        <Text style={styles.muted}>{`and ${data.mergeConflicts.length - 12} more`}</Text>
      ) : null}
    </View>
  );
}

export function SyncReportCard({ item, theme }: PluginTimelineItemProps<SyncReportData>) {
  const data = item.data;
  const styles = useCardStyles(theme);
  const [expanded, setExpanded] = useState(true);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const summary = summarizeSync(data);

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.header}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={`Sync status: ${summary.headline}`}
      >
        <Icon name="GitCompareArrows" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.tag}>sync</Text>
        <Text style={styles.headlineTone[summary.tone]} numberOfLines={expanded ? undefined : 1}>
          {summary.headline}
        </Text>
        <Text style={styles.time}>{formatTime(data.checkedAt)}</Text>
        <Icon
          name={expanded ? "ChevronDown" : "ChevronRight"}
          size={14}
          color={theme.colors.foregroundMuted}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          {data.error ? (
            <Text style={styles.hintDanger} selectable>
              {data.error}
            </Text>
          ) : null}
          {data.worktree || data.main ? (
            <View style={styles.section}>
              {data.worktree ? (
                <SideRow label="Worktree" side={data.worktree} styles={styles} />
              ) : null}
              {data.main ? <SideRow label="Main project" side={data.main} styles={styles} /> : null}
            </View>
          ) : null}
          <CommitList title="Only in the worktree" commits={data.toMain} styles={styles} />
          <CommitList title="Only in the main project" commits={data.fromMain} styles={styles} />
          <MergePreview data={data} styles={styles} />
          {summary.hint ? <Text style={styles.hint}>{summary.hint}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
