import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { buildLaterSchedule, scheduleName, type sendLaterRpc } from "../shared/later";

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
