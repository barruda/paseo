import { randomUUID } from "node:crypto";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  answeredData,
  type askBtwRpc,
  BTW_TIMELINE_KIND,
  BTW_TIMELINE_VERSION,
  type BtwTimelineData,
} from "../shared/btw";

export async function askBtw(
  input: RpcInput<typeof askBtwRpc>,
  { paseo }: PluginHandlerContext,
): Promise<{ id: string }> {
  const id = `btw-${randomUUID()}`;
  const agent = paseo.agents.ref(input.agentId);
  const publish = (data: BtwTimelineData) =>
    agent.timeline.append({
      type: "plugin",
      id,
      kind: BTW_TIMELINE_KIND,
      version: BTW_TIMELINE_VERSION,
      data,
    });
  const asked: BtwTimelineData = {
    question: input.question,
    status: "asking",
    answer: null,
    error: null,
    askedAt: new Date().toISOString(),
    durationMs: null,
  };
  await publish(asked);
  const startedAt = Date.now();
  void agent
    .askSideQuestion(input.question)
    .catch((error: unknown) => ({
      answer: null,
      error: error instanceof Error ? error.message : String(error),
    }))
    .then((result) => publish(answeredData(asked, result, Date.now() - startedAt)))
    .catch((error: unknown) => console.error(`[btw] failed to append timeline row ${id}`, error));
  return { id };
}
