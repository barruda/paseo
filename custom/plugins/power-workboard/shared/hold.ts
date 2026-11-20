// CUSTOM(resource-pools): why a pool holds back an orchestrator's tasks or a delivery's fix. Its
// own module because both `model.ts` (orchestrator status) and `assistant.ts` (queued fix) use it,
// and `model.ts` already imports `assistant.ts`.
// CUSTOM(orchestrator-in-place): a folder hold keeps one in-place task at a time in a project
// folder; it is not a pool, so it carries the folder and the task that is using it.
import { z } from "zod";

/**
 * `settle`: the pool has a RAM floor and started an agent less than `RAM_SETTLE_MS` ago, so the
 * RAM it will use doesn't show yet; it waits until `until`.
 */
const poolHoldSchema = z.object({
  kind: z.enum(["pool", "ram", "settle"]),
  poolId: z.string(),
  poolName: z.string(),
  running: z.number(),
  maxConcurrent: z.number(),
  freeRamPercent: z.number().nullable(),
  minFreeRamPercent: z.number().nullable(),
  until: z.string().nullable().default(null),
});
const folderHoldSchema = z.object({
  kind: z.literal("folder"),
  directory: z.string(),
  taskTitle: z.string().nullable().default(null),
});
export const orchestratorHoldSchema = z.discriminatedUnion("kind", [
  poolHoldSchema,
  folderHoldSchema,
]);
export type OrchestratorHold = z.infer<typeof orchestratorHoldSchema>;
