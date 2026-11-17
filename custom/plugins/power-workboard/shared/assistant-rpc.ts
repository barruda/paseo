// CUSTOM(projects-assistant): RPCs of the Projects Assistant. The app's Settings page calls the two
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
