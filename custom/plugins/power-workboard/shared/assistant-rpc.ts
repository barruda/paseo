// CUSTOM(projects-assistant): RPCs of the Project Manager. The app's Settings page calls the two
// settings RPCs by name (`plugin.invoke(name, input)`), so keep those names stable.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  assistantActionInputSchema,
  assistantProjectSchema,
  assistantSettingsSchema,
  conversationCursorSchema,
  conversationSchema,
  historyEventKindSchema,
  historyEventSchema,
  overviewSchema,
  statsSchema,
  treeSchema,
} from "./assistant";
import {
  QUICK_MESSAGE_MAX,
  QUICK_WAIT_MAX_MS,
  quickAckSchema,
  quickMessageSchema,
} from "./quick"; // CUSTOM(assistant-quick)
import {
  reportColumnSchema,
  reportTaskSchema,
  reportTimelineSchema,
} from "./assistant-reports"; // CUSTOM(assistant-reports)
import { pmCardSchema } from "./pm-board"; // CUSTOM(pm-board)

const settingsOutput = z.object({
  settings: assistantSettingsSchema,
  projects: z.array(assistantProjectSchema),
});

export const assistantSettingsGetRpc = defineRpc({
  name: "workboard.assistant.settings.get",
  input: z.object({}),
  output: settingsOutput,
});

export const assistantSettingsSetRpc = defineRpc({
  name: "workboard.assistant.settings.set",
  input: z.object({ settings: assistantSettingsSchema }),
  output: settingsOutput,
});

export const assistantOverviewRpc = defineRpc({
  name: "workboard.assistant.overview",
  input: z.object({}),
  output: overviewSchema,
});

export const assistantStatsRpc = defineRpc({
  name: "workboard.assistant.stats",
  input: z.object({ days: z.number().int().min(1).max(90).default(14) }),
  output: statsSchema,
});

export const assistantHistoryRpc = defineRpc({
  name: "workboard.assistant.history.list",
  input: z.object({
    /** Opaque; from the previous page's `nextCursor`. */
    cursor: z.string().nullable().default(null),
    limit: z.number().int().min(1).max(200).default(50),
    projectId: z.string().nullable().default(null),
    orchestratorId: z.string().nullable().default(null),
    taskId: z.string().nullable().default(null),
    kinds: z.array(historyEventKindSchema).default([]),
    /** ISO timestamps, inclusive. */
    from: z.string().nullable().default(null),
    to: z.string().nullable().default(null),
  }),
  output: z.object({
    /** Newest first. */
    events: z.array(historyEventSchema),
    nextCursor: z.string().nullable(),
  }),
});

export const assistantTreeRpc = defineRpc({
  name: "workboard.assistant.tree",
  input: z.object({}),
  output: treeSchema,
});

export const assistantConversationRpc = defineRpc({
  name: "workboard.assistant.conversation.read",
  input: z.object({
    agentId: z.string(),
    before: conversationCursorSchema.nullable().default(null),
    limit: z.number().int().min(1).max(500).default(150),
  }),
  output: conversationSchema,
});

export const assistantActionRpc = defineRpc({
  name: "workboard.assistant.action",
  input: assistantActionInputSchema,
  output: z.object({ ok: z.literal(true) }),
});

/**
 * Opens the Project Manager chat: returns the current chat agent, creating one when there is
 * none, it is archived or gone, or `fresh` asks for a new conversation.
 */
export const assistantChatOpenRpc = defineRpc({
  name: "workboard.assistant.chat.open",
  // CUSTOM(assistant-restart-pill): `archivePrevious` archives the chat a `fresh` open replaces.
  input: z.object({
    fresh: z.boolean().default(false),
    archivePrevious: z.boolean().default(false),
  }),
  output: z.object({ agentId: z.string(), created: z.boolean() }),
});

// CUSTOM(assistant-quick): a message to the assistant from outside its chat, and its short ack.
// The external contract (`paseo plugin rpc power-workboard workboard.assistant.ask`) is in README.md.
export const assistantAskRpc = defineRpc({
  name: "workboard.assistant.ask",
  input: z.object({
    text: z.string().trim().min(1).max(QUICK_MESSAGE_MAX),
    source: z.string().trim().min(1).max(40).default("app"),
    waitMs: z.number().int().min(0).max(QUICK_WAIT_MAX_MS).default(20_000),
  }),
  output: quickAckSchema,
});

export const assistantQuickGetRpc = defineRpc({
  name: "workboard.assistant.quick.get",
  input: z.object({
    id: z.string(),
    waitMs: z.number().int().min(0).max(QUICK_WAIT_MAX_MS).default(0),
  }),
  output: quickAckSchema,
});

/** Newest first. */
export const assistantQuickListRpc = defineRpc({
  name: "workboard.assistant.quick.list",
  input: z.object({}),
  output: z.object({ items: z.array(quickMessageSchema) }),
});

// CUSTOM(assistant-reports): the Projects Reports page. Tickets with actions, newest action first.
export const assistantReportsTasksRpc = defineRpc({
  name: "workboard.assistant.reports.tasks",
  input: z.object({}),
  output: z.object({
    tasks: z.array(reportTaskSchema),
    columns: z.array(reportColumnSchema),
  }),
});

/** One ticket's timeline; null when nothing was recorded for it. */
export const assistantReportsTaskRpc = defineRpc({
  name: "workboard.assistant.reports.task",
  input: z.object({ taskId: z.string().min(1) }),
  output: z.object({ timeline: reportTimelineSchema.nullable() }),
});

// CUSTOM(pm-board): the Project Manager's own cards. The page reads them here and decides or
// reopens a card; both actions also send a message to the PM chat.
export const assistantPmCardsRpc = defineRpc({
  name: "workboard.assistant.pm.cards",
  input: z.object({}),
  output: z.object({
    cards: z.array(pmCardSchema),
    /** Short task numbers for the links under a card, by task id. */
    taskNumbers: z.record(z.string(), z.number()).default({}),
  }),
});

export const assistantPmDecideRpc = defineRpc({
  name: "workboard.assistant.pm.card.decide",
  input: z.object({
    cardId: z.string().min(1),
    /** An option of the card; null when the user wrote an answer. */
    optionId: z.string().max(40).nullable().default(null),
    answer: z.string().max(5000).nullable().default(null),
  }),
  output: z.object({
    card: pmCardSchema,
    /** The message sent to the PM chat; null when it could not be sent. */
    messageId: z.string().nullable(),
  }),
});

export const assistantPmReopenRpc = defineRpc({
  name: "workboard.assistant.pm.card.reopen",
  input: z.object({ cardId: z.string().min(1) }),
  output: z.object({
    card: pmCardSchema,
    messageId: z.string().nullable(),
  }),
});
