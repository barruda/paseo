// CUSTOM(resource-pools): why a pool holds back an orchestrator's tasks or a delivery's fix. Its
// own module because both `model.ts` (orchestrator status) and `assistant.ts` (queued fix) use it,
// and `model.ts` already imports `assistant.ts`.
import { z } from "zod";

/**
 * `settle`: the pool has a RAM floor and started an agent less than `RAM_SETTLE_MS` ago, so the
 * RAM it will use doesn't show yet; it waits until `until`.
 */
export const orchestratorHoldSchema = z.object({
  kind: z.enum(["pool", "ram", "settle"]),
  poolId: z.string(),
  poolName: z.string(),
  running: z.number(),
  maxConcurrent: z.number(),
  freeRamPercent: z.number().nullable(),
  minFreeRamPercent: z.number().nullable(),
  until: z.string().nullable().default(null),
});
export type OrchestratorHold = z.infer<typeof orchestratorHoldSchema>;
