import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const BTW_TIMELINE_KIND = "btw";
export const BTW_TIMELINE_VERSION = 1;

export const btwTimelineSchema = z.object({
  question: z.string(),
  status: z.enum(["asking", "answered", "failed"]),
  answer: z.string().nullable(),
  error: z.string().nullable(),
  askedAt: z.string(),
  durationMs: z.number().nullable(),
});

export type BtwTimelineData = z.output<typeof btwTimelineSchema>;

/** Adds the card right away and fills in the answer when it arrives. */
export const askBtwRpc = defineRpc({
  name: "ask",
  input: z.object({ agentId: z.string().min(1), question: z.string().min(1) }),
  output: z.object({ id: z.string() }),
});

// The row keeps the whole answer; the plugin row limit is 64 KiB.
const MAX_ANSWER_CHARS = 48 * 1024;

export function answeredData(
  asked: BtwTimelineData,
  result: { answer: string | null; error: string | null },
  durationMs: number,
): BtwTimelineData {
  if (result.error) return { ...asked, status: "failed", error: result.error, durationMs };
  const answer = result.answer ?? "Claude declined to answer this side question.";
  return {
    ...asked,
    status: "answered",
    answer:
      answer.length > MAX_ANSWER_CHARS ? `${answer.slice(0, MAX_ANSWER_CHARS)}\n\n[…]` : answer,
    durationMs,
  };
}
