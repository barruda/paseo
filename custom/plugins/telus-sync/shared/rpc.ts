import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  categoryIdSchema,
  historyEntrySchema,
  previewCategorySchema,
  runResultSchema,
  statusSchema,
} from "./model";

const selectionSchema = z.object({
  categories: z.array(categoryIdSchema).min(1),
});

export const telusSyncStatusRpc = defineRpc({
  name: "telus-sync.status",
  input: z.object({}),
  output: statusSchema,
});

/** What each selected category would change, and what is already the same. */
export const telusSyncPreviewRpc = defineRpc({
  name: "telus-sync.preview",
  input: selectionSchema,
  output: z.object({ categories: z.array(previewCategorySchema) }),
});

/** Back up the Telus files that would be overwritten, then copy the selected categories. */
export const telusSyncRunRpc = defineRpc({
  name: "telus-sync.run",
  input: selectionSchema,
  output: runResultSchema,
});

export const telusSyncHistoryRpc = defineRpc({
  name: "telus-sync.history",
  input: z.object({}),
  output: z.object({ entries: z.array(historyEntrySchema) }),
});

/** Restore the Telus files captured by a sync's backup. */
export const telusSyncRollbackRpc = defineRpc({
  name: "telus-sync.rollback",
  input: z.object({ backupId: z.string().min(1) }),
  output: runResultSchema,
});
