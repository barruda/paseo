import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  buildLaterSchedule,
  isLaterSchedule,
  type PendingLater,
  pendingLater,
  scheduleName,
  type cancelLaterRpc,
  type listLaterRpc,
  type sendLaterRpc,
} from "../shared/later";

export async function sendLater(
  input: RpcInput<typeof sendLaterRpc>,
  { paseo }: PluginHandlerContext,
): Promise<{ runAt: string }> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const plan = buildLaterSchedule(new Date(), input.delayMs, timezone);
  await paseo.schedules.create({
    name: scheduleName(input.message),
    prompt: input.message,
    cadence: { type: "cron", expression: plan.expression, timezone: plan.timezone },
    target: { type: "agent", agentId: input.agentId },
    maxRuns: 1,
    expiresAt: plan.expiresAt.toISOString(),
    runOnCreate: false,
  });
  return { runAt: plan.runAt.toISOString() };
}

export async function listLater(
  input: RpcInput<typeof listLaterRpc>,
  { paseo }: PluginHandlerContext,
): Promise<{ items: PendingLater[] }> {
  const schedules = await paseo.schedules.list();
  return { items: pendingLater(schedules, input.agentId) };
}

export async function cancelLater(
  input: RpcInput<typeof cancelLaterRpc>,
  { paseo }: PluginHandlerContext,
): Promise<Record<string, never>> {
  const schedules = await paseo.schedules.list();
  const found = schedules.find((schedule) => schedule.id === input.id);
  if (!found || !isLaterSchedule(found)) throw new Error("That is not a pending /later message.");
  await paseo.schedules.delete(input.id);
  return {};
}
