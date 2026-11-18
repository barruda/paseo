// CUSTOM(report-card): finds the `<report>{...}</report>` block a task agent ends its reply with,
// and maps it to the timeline items that replace the raw JSON with a card in the agent chat.
// The server reads the same block for delivery (server/assistant/report.ts).
import { z } from "zod";
import {
  REPORT_STATUSES,
  progressSchema,
  reportSchema,
  type Report,
} from "./assistant";

const BLOCK = /<report>([\s\S]*?)<\/report>/gi;

export interface ReportBlock {
  /** Index of `<report>` in the text. */
  start: number;
  /** Index just after `</report>`. */
  end: number;
  /** What sits between the tags. */
  body: string;
}

/** The LAST `<report>...</report>` block of a text, or null. */
export function lastReportBlock(text: string): ReportBlock | null {
  let last: RegExpExecArray | null = null;
  for (const match of text.matchAll(BLOCK)) last = match;
  if (!last) return null;
  return {
    start: last.index,
    end: last.index + last[0].length,
    body: last[1],
  };
}

/** The block's JSON, validated against the report schema; null when it is not a report. */
export function parseReportBody(body: string): Report | null {
  try {
    const parsed = reportSchema.safeParse(JSON.parse(body.trim()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * True when `index` falls inside a fenced code block or right after an inline-code backtick: an
 * agent quoting the report format is not reporting.
 */
function insideCode(text: string, index: number): boolean {
  if (text[index - 1] === "`") return true;
  const fences = text.slice(0, index).match(/^ {0,3}(```|~~~)/gm);
  return (fences?.length ?? 0) % 2 === 1;
}

export interface TaskReportSplit {
  /** The reply before the block, trimmed. */
  before: string;
  report: Report;
  /** The reply after the block, trimmed. Usually empty. */
  after: string;
}

/** Splits a reply around its last valid report block; null when there is none to show as a card. */
export function splitTaskReport(text: string): TaskReportSplit | null {
  const block = lastReportBlock(text);
  if (!block || insideCode(text, block.start)) return null;
  const report = parseReportBody(block.body);
  if (!report) return null;
  return {
    before: text.slice(0, block.start).trim(),
    report,
    after: text.slice(block.end).trim(),
  };
}

export const REPORT_CARD_KIND = "task-report-card";
export const REPORT_TEXT_KIND = "task-report-text";
export const REPORT_ITEM_VERSION = 1;

/** Data of the card item. Same shape as the report, with every field present. */
export const reportCardDataSchema = z.object({
  status: z.enum(REPORT_STATUSES),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  checks: z.array(z.object({ command: z.string(), passed: z.boolean() })),
  risks: z.array(z.string()),
  question: z.string().nullable(),
  // CUSTOM(task-checkpoints): optional, so cards stored before checkpoints still parse.
  progress: progressSchema.nullable().optional(),
  resumeAfter: z.string().nullable().optional(),
  waitingFor: z.string().nullable().optional(),
});
export type ReportCardData = z.infer<typeof reportCardDataSchema>;

/** Data of a text item: Markdown around the report, rendered the way the chat renders replies. */
export const reportTextDataSchema = z.object({ text: z.string() });
export type ReportTextData = z.infer<typeof reportTextDataSchema>;

export type ReportTone = "success" | "warning" | "danger" | "info";

/** Color tone and Lucide icon of each status. */
export const REPORT_STATUS_LOOK: Record<
  Report["status"],
  { tone: ReportTone; icon: string }
> = {
  done: { tone: "success", icon: "CircleCheck" },
  needs_input: { tone: "warning", icon: "CircleHelp" },
  blocked: { tone: "danger", icon: "Ban" },
  failed: { tone: "danger", icon: "CircleX" },
  checkpoint: { tone: "info", icon: "Flag" }, // CUSTOM(task-checkpoints)
};

export interface ReportTimelineItem {
  type: "plugin";
  id: string;
  kind: string;
  version: number;
  data: ReportCardData | ReportTextData;
}

/**
 * The items that replace an assistant reply carrying a valid report: the text before it, the
 * card, and any text after it. Undefined keeps the reply as it is (no block, invalid JSON,
 * missing fields, or a block quoted in code).
 */
export function reportTimelineItems(
  text: string,
): ReportTimelineItem[] | undefined {
  const split = splitTaskReport(text);
  if (!split) return undefined;
  const { report } = split;
  const items: ReportTimelineItem[] = [];
  if (split.before) {
    items.push({
      type: "plugin",
      id: "before",
      kind: REPORT_TEXT_KIND,
      version: REPORT_ITEM_VERSION,
      data: { text: split.before },
    });
  }
  items.push({
    type: "plugin",
    id: "card",
    kind: REPORT_CARD_KIND,
    version: REPORT_ITEM_VERSION,
    data: {
      status: report.status,
      summary: report.summary,
      filesChanged: report.filesChanged,
      checks: report.checks,
      risks: report.risks,
      question: report.question,
      progress: report.progress,
      resumeAfter: report.resumeAfter,
      waitingFor: report.waitingFor,
    },
  });
  if (split.after) {
    items.push({
      type: "plugin",
      id: "after",
      kind: REPORT_TEXT_KIND,
      version: REPORT_ITEM_VERSION,
      data: { text: split.after },
    });
  }
  return items;
}

/** Markdown list of the changed files as inline code, so the chat makes each path a file link. */
export function filesChangedMarkdown(files: readonly string[]): string {
  return files.map((file) => `- \`${file.replace(/`/g, "")}\``).join("\n");
}
