// CUSTOM(report-card): the agent chat shows a task agent's `<report>` block as this card instead
// of raw JSON. The transformer and the data contract live in shared/task-report.ts.
import { useState, type ComponentType } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import * as hostUi from "@getpaseo/plugin/client/ui";
import {
  REPORT_STATUS_LOOK,
  filesChangedMarkdown,
  type ReportCardData,
  type ReportTextData,
  type ReportTone,
} from "../../shared/task-report";
import { formatClock } from "../checkpoint-format"; // CUSTOM(task-checkpoints)
import { usePaseoLocale } from "../paseo-language";
import { reportsStrings } from "./reports-strings";

type Theme = PluginTimelineItemProps["theme"];

// The pinned SDK types predate the host's Markdown component (Paseo's chat Markdown engine, with
// its file links). Older apps without it get selectable plain text.
const HostMarkdown = (
  hostUi as unknown as {
    Markdown?: ComponentType<{ children: string }>;
  }
).Markdown;

function toneColor(tone: ReportTone, theme: Theme): string {
  const c = theme.colors;
  if (tone === "success") return c.statusSuccess;
  if (tone === "warning") return c.statusWarning;
  if (tone === "info") return c.accent; // CUSTOM(task-checkpoints)
  return c.statusDanger;
}

/** A light wash of a `#rrggbb` color for backgrounds; other formats get none. */
function wash(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}1f` : "transparent";
}

function MarkdownText({ text, theme }: { text: string; theme: Theme }) {
  if (HostMarkdown) return <HostMarkdown>{text}</HostMarkdown>;
  return (
    <Text selectable style={[styles.body, { color: theme.colors.foreground }]}>
      {text}
    </Text>
  );
}

/** The reply text around the report, rendered like the rest of the chat. */
export function TaskReportText({
  item,
  theme,
}: PluginTimelineItemProps<ReportTextData>) {
  return <MarkdownText text={item.data.text} theme={theme} />;
}

function SectionTitle({ text, theme }: { text: string; theme: Theme }) {
  return (
    <Text
      style={[styles.sectionTitle, { color: theme.colors.foregroundMuted }]}
    >
      {text}
    </Text>
  );
}

export function TaskReportCard({
  item,
  theme,
}: PluginTimelineItemProps<ReportCardData>) {
  const report = item.data;
  const t = reportsStrings(usePaseoLocale());
  const [filesOpen, setFilesOpen] = useState(false);
  const c = theme.colors;
  const look = REPORT_STATUS_LOOK[report.status];
  const color = toneColor(look.tone, theme);
  const label = t.reportStatus[report.status] ?? report.status;
  // CUSTOM(task-checkpoints)
  const waitParts = [
    report.waitingFor ? `${t.waitingFor} ${report.waitingFor}` : null,
    report.resumeAfter
      ? `${t.resumes} ${formatClock(report.resumeAfter, new Date())}`
      : null,
  ].filter(Boolean);
  const filesTitle = `${t.filesChanged} (${report.filesChanged.length})`;

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: c.border,
          borderLeftColor: color,
          backgroundColor: c.surface1,
        },
      ]}
    >
      <View style={styles.head}>
        <View
          style={[
            styles.badge,
            { borderColor: color, backgroundColor: wash(color) },
          ]}
          accessibilityLabel={`${t.report}: ${label}`}
        >
          <Icon name={look.icon} size={14} color={color} />
          <Text style={[styles.badgeText, { color }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
        <Text style={[styles.headLabel, { color: c.foregroundMuted }]}>
          {t.report}
        </Text>
      </View>

      <Text selectable style={[styles.summary, { color: c.foreground }]}>
        {report.summary}
      </Text>

      {/* CUSTOM(task-checkpoints) */}
      {report.progress &&
      report.progress.done.length + report.progress.next.length > 0 ? (
        <View style={styles.section}>
          {report.progress.done.map((item, index) => (
            <View key={`done-${index}`} style={styles.rowTop}>
              <Icon name="Check" size={14} color={c.statusSuccess} />
              <Text
                selectable
                style={[styles.body, styles.grow, { color: c.foreground }]}
              >
                {item}
              </Text>
            </View>
          ))}
          {report.progress.next.map((item, index) => (
            <View key={`next-${index}`} style={styles.rowTop}>
              <Icon name="Circle" size={14} color={c.foregroundMuted} />
              <Text
                selectable
                style={[styles.body, styles.grow, { color: c.foregroundMuted }]}
              >
                {item}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {waitParts.length > 0 ? (
        <View style={styles.row}>
          <Icon name="Clock" size={14} color={c.foregroundMuted} />
          <Text style={[styles.body, { color: c.foregroundMuted }]}>
            {waitParts.join(" · ")}
          </Text>
        </View>
      ) : null}

      {report.question ? (
        <View
          style={[
            styles.question,
            {
              borderColor: c.statusWarning,
              backgroundColor: wash(c.statusWarning),
            },
          ]}
        >
          <View style={styles.row}>
            <Icon name="CircleHelp" size={14} color={c.statusWarning} />
            <Text style={[styles.questionLabel, { color: c.statusWarning }]}>
              {t.question}
            </Text>
          </View>
          <Text selectable style={[styles.body, { color: c.foreground }]}>
            {report.question}
          </Text>
        </View>
      ) : null}

      {report.checks.length > 0 ? (
        <View style={styles.section}>
          <SectionTitle text={t.checks} theme={theme} />
          {report.checks.map((check, index) => (
            <View key={index} style={styles.row}>
              <Icon
                name={check.passed ? "Check" : "X"}
                size={14}
                color={check.passed ? c.statusSuccess : c.statusDanger}
              />
              <Text
                selectable
                style={[styles.mono, styles.grow, { color: c.foreground }]}
              >
                {check.command}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {report.filesChanged.length > 0 ? (
        <View style={styles.section}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: filesOpen }}
            accessibilityLabel={filesTitle}
            onPress={() => setFilesOpen((open) => !open)}
            style={styles.row}
          >
            <Icon
              name={filesOpen ? "ChevronDown" : "ChevronRight"}
              size={14}
              color={c.foregroundMuted}
            />
            <Text style={[styles.sectionTitle, { color: c.foregroundMuted }]}>
              {filesTitle}
            </Text>
          </Pressable>
          {filesOpen ? (
            <View style={styles.files}>
              <MarkdownText
                text={filesChangedMarkdown(report.filesChanged)}
                theme={theme}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {report.risks.length > 0 ? (
        <View style={styles.section}>
          <SectionTitle text={t.risks} theme={theme} />
          {report.risks.map((risk, index) => (
            <View key={index} style={styles.rowTop}>
              <Icon name="TriangleAlert" size={14} color={c.statusWarning} />
              <Text
                selectable
                style={[styles.body, styles.grow, { color: c.foreground }]}
              >
                {risk}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 8,
    padding: 12,
    gap: 10,
    marginVertical: 4,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  headLabel: { fontSize: 12 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 12, fontWeight: "600" },
  summary: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
  body: { fontSize: 13, lineHeight: 19 },
  mono: { fontSize: 12, fontFamily: "monospace" },
  question: { borderWidth: 1, borderRadius: 6, padding: 10, gap: 4 },
  questionLabel: { fontSize: 12, fontWeight: "600" },
  section: { gap: 4 },
  sectionTitle: { fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  grow: { flex: 1, minWidth: 0 },
  files: { paddingLeft: 20 },
});
