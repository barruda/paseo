import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  answeredData,
  type askBtwRpc,
  BTW_TIMELINE_KIND,
  BTW_TIMELINE_VERSION,
  type BtwFollowUp,
  type BtwTimelineData,
  type followUpBtwRpc,
  remainingAnswerChars,
  threadHistory,
  TLDR_PROMPT,
  TLDR_QUESTION,
} from "../shared/btw";

// The last state of each card, so follow-ups sent in quick succession build on each other.
const cards = new Map<string, BtwTimelineData>();

function cardPublisher(paseo: PluginHandlerContext["paseo"], agentId: string, id: string) {
  const agent = paseo.agents.ref(agentId);
  return {
    agent,
    publish(data: BtwTimelineData) {
      cards.set(id, data);
      return agent.timeline.append({
        type: "plugin",
        id,
        kind: BTW_TIMELINE_KIND,
        version: BTW_TIMELINE_VERSION,
        data,
      });
    },
  };
}

function errorAnswer(error: unknown) {
  return { answer: null, error: error instanceof Error ? error.message : String(error) };
}

export async function askBtw(
  input: RpcInput<typeof askBtwRpc>,
  { paseo }: PluginHandlerContext,
): Promise<{ id: string }> {
  const id = `btw-${randomUUID()}`;
  const { agent, publish } = cardPublisher(paseo, input.agentId, id);
  const asked: BtwTimelineData = {
    id,
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
    .catch(errorAnswer)
    .then((result) => publish(answeredData(asked, result, Date.now() - startedAt)))
    .catch((error: unknown) => console.error(`[btw] failed to append timeline row ${id}`, error));
  return { id };
}

const MAX_FILE_CHARS = 64 * 1024;

/** Side questions take text only, so attached files go into the question. */
export async function inlineFiles(
  question: string,
  files: RpcInput<typeof followUpBtwRpc>["files"],
): Promise<string> {
  const parts = [question];
  for (const file of files) {
    if (file.mimeType.startsWith("image/")) {
      parts.push(`[Attached image ${file.fileName}: side questions cannot see images.]`);
      continue;
    }
    const bytes = await readFile(file.path);
    if (bytes.includes(0)) {
      parts.push(`[Attached binary file ${file.fileName}: not included.]`);
      continue;
    }
    const text = bytes.toString("utf8");
    const body = text.length > MAX_FILE_CHARS ? `${text.slice(0, MAX_FILE_CHARS)}\n[… cut]` : text;
    parts.push(`<attached_file name="${file.fileName}">\n${body}\n</attached_file>`);
  }
  return parts.join("\n\n");
}

export async function followUpBtw(
  input: RpcInput<typeof followUpBtwRpc>,
  { paseo }: PluginHandlerContext,
): Promise<{ ok: true }> {
  const { agent, publish } = cardPublisher(paseo, input.agentId, input.cardId);
  const card = cards.get(input.cardId) ?? input.card;
  const isTldr = input.kind === "tldr";
  const question = isTldr ? TLDR_QUESTION : input.question.trim();
  if (!question) throw new Error("Type a follow-up question.");
  const prompt = isTldr ? TLDR_PROMPT : await inlineFiles(question, input.files);
  const history = threadHistory(card);
  const asked: BtwFollowUp = {
    kind: input.kind,
    question,
    fileNames: input.files.map((file) => file.fileName),
    status: "asking",
    answer: null,
    error: null,
    askedAt: new Date().toISOString(),
    durationMs: null,
  };
  const index = card.followUps?.length ?? 0;
  await publish({ ...card, followUps: [...(card.followUps ?? []), asked] });
  const startedAt = Date.now();
  void agent
    .askSideQuestion(prompt, { history })
    .catch(errorAnswer)
    .then((result) => {
      const latest = cards.get(input.cardId) ?? card;
      const followUps = [...(latest.followUps ?? [])];
      followUps[index] = answeredData(
        asked,
        result,
        Date.now() - startedAt,
        remainingAnswerChars(latest),
      );
      return publish({ ...latest, followUps });
    })
    .catch((error: unknown) =>
      console.error(`[btw] failed to append timeline row ${input.cardId}`, error),
    );
  return { ok: true };
}
