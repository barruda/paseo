// CUSTOM(assistant-reports): the one record the Projects Assistant writes per action on a ticket
// (`board_report`), and the Projects Reports page built from those records plus the history the
// server writes by itself. The same `summary` feeds the page, the quick-message ack in the status
// row (when the record names a `quickMessageId`) and the assistant's short chat reply.
import { z } from "zod";
import {
  historyEventKindSchema,
  reportSchema,
  type HistoryEventKind,
} from "./assistant";
import { GROUP_COLORS, stageKindSchema } from "./model";
import { ACK_MESSAGE_MAX, ackStatusSchema } from "./quick";

export const REPORT_ENTRY_KINDS = [
  "created",
  "started",
  "moved",
  "reviewed",
  "feedback",
  "answered",
  "fixed",
  "merged",
  "escalated",
  "note",
] as const;
export const reportEntryKindSchema = z.enum(REPORT_ENTRY_KINDS);
export type ReportEntryKind = z.infer<typeof reportEntryKindSchema>;

/** The summary is also the status row's ack, so it has the ack's limit. */
export const REPORT_SUMMARY_MAX = ACK_MESSAGE_MAX;
export const REPORT_DETAIL_MAX = 8000;
export const REPORT_REPLY_MAX = 20000;

/** What `board_report` accepts. Unknown fields are refused so a misspelled field is not lost. */
export const reportEntryInputSchema = z
  .object({
    taskId: z.string().trim().min(1),
    kind: reportEntryKindSchema,
    summary: z
      .string()
      .trim()
      .min(1)
      .max(REPORT_SUMMARY_MAX)
      .regex(/^[^\r\n]+$/, "summary must be one line (one sentence)"),
    detail: z.string().trim().max(REPORT_DETAIL_MAX).optional(),
    decisions: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
    orchestrator: z
      .object({
        agentId: z.string().trim().min(1),
        prompt: z.string().trim().max(REPORT_REPLY_MAX).optional(),
        reply: z
          .string()
          .trim()
          .max(REPORT_REPLY_MAX * 2)
          .optional(),
      })
      .strict()
      .optional(),
    quickMessageId: z.string().trim().min(1).optional(),
    /** The status row's state for `quickMessageId`; defaults to its current one (ok while pending). */
    quickStatus: ackStatusSchema.optional(),
    /** Accepted for convenience; the task's own project is stored. */
    projectId: z.string().optional(),
  })
  .strict();
export type ReportEntryInput = z.infer<typeof reportEntryInputSchema>;

export const reportOrchestratorSchema = z.object({
  agentId: z.string(),
  /** What the assistant asked the task's agent. */
  prompt: z.string().nullable().default(null),
  /** The agent's answer without its `<report>` block. */
  reply: z.string().nullable().default(null),
  /** The agent's `<report>`, parsed from the reply. */
  report: reportSchema.nullable().default(null),
});
export type ReportOrchestrator = z.infer<typeof reportOrchestratorSchema>;

/** One line of `plugin-data/power-workboard/reports/YYYY-MM-DD.jsonl`. */
export const assistantReportSchema = z.object({
  id: z.string(),
  at: z.string(),
  taskId: z.string(),
  taskTitle: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string(),
  kind: reportEntryKindSchema,
  summary: z.string(),
  detail: z.string().nullable().default(null),
  decisions: z.array(z.string()).default([]),
  orchestrator: reportOrchestratorSchema.nullable().default(null),
  quickMessageId: z.string().nullable().default(null),
});
export type AssistantReport = z.infer<typeof assistantReportSchema>;

/** A ticket in the Reports sidebar. */
export const reportTaskSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string(),
  /** Board column label; null when the task is no longer on the board. */
  column: z.string().nullable(),
  /** Board column id (its group); null when the task is no longer on the board. */
  columnId: z.string().nullable(),
  /** The newest item's time and summary. */
  lastAt: z.string(),
  lastSummary: z.string(),
  /** Timeline items, and how many of them the assistant wrote. */
  items: z.number().int(),
  assistantItems: z.number().int(),
});
export type ReportTask = z.infer<typeof reportTaskSchema>;

/** A board column, in board order, for the Reports status filter. */
export const reportColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: stageKindSchema,
  color: z.enum(GROUP_COLORS),
});
export type ReportColumn = z.infer<typeof reportColumnSchema>;

/** A history event folded into an assistant item, or standing alone as an automatic item. */
export const reportEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: historyEventKindSchema,
  text: z.string(),
  detail: z.string().nullable(),
  agentId: z.string().nullable(),
  /** The task's agent for this event, with its report when the event is that report. */
  orchestrator: reportOrchestratorSchema.nullable().default(null),
});
export type ReportEvent = z.infer<typeof reportEventSchema>;

export const reportTimelineItemSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("assistant"),
    id: z.string(),
    at: z.string(),
    kind: reportEntryKindSchema,
    summary: z.string(),
    detail: z.string().nullable(),
    decisions: z.array(z.string()),
    orchestrator: reportOrchestratorSchema.nullable(),
    quickMessageId: z.string().nullable(),
    /** The automatic events of this iteration, oldest first. */
    events: z.array(reportEventSchema),
  }),
  z.object({
    source: z.literal("auto"),
    id: z.string(),
    at: z.string(),
    kind: historyEventKindSchema,
    summary: z.string(),
    detail: z.string().nullable(),
    /** The task's agent for this event, with its report when the event is that report. */
    orchestrator: reportOrchestratorSchema.nullable(),
  }),
]);
export type ReportTimelineItem = z.infer<typeof reportTimelineItemSchema>;

export const reportTimelineSchema = z.object({
  task: z.object({
    taskId: z.string(),
    title: z.string(),
    projectId: z.string().nullable(),
    projectName: z.string(),
    column: z.string().nullable(),
    /** What was asked: the task's description (empty once the task left the board). */
    description: z.string(),
  }),
  /** Oldest first. */
  items: z.array(reportTimelineItemSchema),
});
export type ReportTimeline = z.infer<typeof reportTimelineSchema>;

export type ReportItemKind = ReportEntryKind | HistoryEventKind;
