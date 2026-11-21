// CUSTOM(report-card): the agent chat shows a task agent's `<report>` block as this card instead
// of raw JSON. The transformer and the data contract live in shared/task-report.ts.
import { useState, type ComponentType } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
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
import { assistantActionRpc } from "../../shared/assistant-rpc";
import { itemFeedback, optionAnswer } from "../../shared/card-answers";
import { Commentable, OutcomeMap, QuestionBlock, wash } from "./card-parts";
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

export { wash }; // CUSTOM(assistant-cards): it lives in card-parts, which this file imports.

export function MarkdownText({ text, theme }: { text: string; theme: Theme }) {
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
  layout,
  agentId,
}: PluginTimelineItemProps<ReportCardData>) {
  const report = item.data;
  const act = useRpc(assistantActionRpc);
  const answer = async (text: string, question: string | null) => {
    await act({ type: "answer", agentId, text, question });
  };
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
  const cardLabels = t.card;
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

      <OutcomeMap
        outcomes={(report.outcomes ?? []).map((o) => ({
          text: o.ask,
          evidence: o.evidence,
          detail: o.detail,
        }))}
        notDone={report.notDone ?? []}
        theme={theme}
        labels={cardLabels}
        hoverable={layout.platform === "web" && !layout.compact}
        onFeedback={(text, feedback) =>
          answer(itemFeedback(text, feedback), null)
        }
      />

      {/* CUSTOM(task-checkpoints) */}
      {report.progress &&
      report.progress.done.length + report.progress.next.length > 0 ? (
        <View style={styles.section}>
          {report.progress.done.map((item, index) => (
            <Commentable
              key={`done-${index}`}
              theme={theme}
              labels={cardLabels}
              onFeedback={(text) => answer(itemFeedback(item, text), null)}
            >
              <View style={styles.rowTop}>
                <Icon name="Check" size={14} color={c.statusSuccess} />
                <Text
                  selectable
                  style={[styles.body, styles.grow, { color: c.foreground }]}
                >
                  {item}
                </Text>
              </View>
            </Commentable>
          ))}
          {report.progress.next.map((item, index) => (
            <Commentable
              key={`next-${index}`}
              theme={theme}
              labels={cardLabels}
              onFeedback={(text) => answer(itemFeedback(item, text), null)}
            >
              <View style={styles.rowTop}>
                <Icon name="Circle" size={14} color={c.foregroundMuted} />
                <Text
                  selectable
                  style={[
                    styles.body,
                    styles.grow,
                    { color: c.foregroundMuted },
                  ]}
                >
                  {item}
                </Text>
              </View>
            </Commentable>
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
        <QuestionBlock
          question={report.question}
          options={report.options ?? []}
          recommend={report.recommend}
          why={report.why}
          theme={theme}
          labels={cardLabels}
          onPick={(option) =>
            answer(optionAnswer(report.question ?? "", option), report.question)
          }
        />
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
  summary: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 13, lineHeight: 19 },
  mono: { fontSize: 12, fontFamily: "monospace" },
  section: { gap: 4 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  grow: { flex: 1, minWidth: 0 },
  files: { paddingLeft: 20 },
});
