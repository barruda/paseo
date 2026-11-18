// CUSTOM(assistant-quick): messages sent to the Projects Assistant from outside its chat (the
// sidebar status row, `/assistant`, `paseo plugin rpc`), and the short classified ack the
// assistant gives each one before its long work. Shared by the server, the client and the
// external contract documented in README.md.
import { z } from "zod";

/** `pending` only while the assistant has not answered yet. */
export const quickStatusSchema = z.enum([
  "pending",
  "ok",
  "needs-input",
  "error",
]);
export type QuickStatus = z.infer<typeof quickStatusSchema>;

/** What the assistant itself may answer through `board_ack`. */
export const ackStatusSchema = z.enum(["ok", "needs-input", "error"]);
export type AckStatus = z.infer<typeof ackStatusSchema>;

export const quickMessageSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** Who sent it: `app`, `slash`, `cli`, `opendeck`... free text, for display. */
  source: z.string(),
  /** ISO; right after the message reached the chat (the conversation jump uses it). */
  sentAt: z.string(),
  agentId: z.string().nullable(),
  status: quickStatusSchema,
  /** The short sentence: the ack, the question, or the error. Null while pending. */
  message: z.string().nullable(),
  ackedAt: z.string().nullable(),
  /** True when the assistant ended its turn without `board_ack` and the reply was classified. */
  inferred: z.boolean(),
});
export type QuickMessage = z.infer<typeof quickMessageSchema>;

/** The external contract's answer. */
export const quickAckSchema = z.object({
  id: z.string(),
  status: quickStatusSchema,
  message: z.string(),
  agentId: z.string().nullable(),
  sentAt: z.string(),
  /** `paseo://h/<serverId>/agent/<agentId>`: opens the conversation in the desktop app. */
  link: z.string().nullable(),
});
export type QuickAck = z.infer<typeof quickAckSchema>;

export const QUICK_MESSAGE_MAX = 20_000;
export const ACK_MESSAGE_MAX = 300;
/** The daemon gives a plugin RPC 30 s; the wait stays under it. */
export const QUICK_WAIT_MAX_MS = 25_000;

/** The marker a quick message starts with in the chat; `board_ack` takes the id inside it. */
export function quickPrompt(id: string, text: string, source: string): string {
  return [
    `[Quick message ${id} from ${source}]`,
    text,
    "",
    `(Sent from outside this chat. Call board_ack FIRST, before any other tool: id "${id}", status "ok" with one short sentence of what you will do, "needs-input" with the question you need answered, or "error" with why you cannot do it. Then do the work.)`,
  ].join("\n");
}

/** One line, at most `max` characters. */
export function oneLine(value: string, max = ACK_MESSAGE_MAX): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Statuses the model may write in its own words, mapped to the contract. */
export function normalizeAckStatus(value: string): AckStatus | null {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (["ok", "ack", "received", "accepted", "working", "done"].includes(key))
    return "ok";
  if (
    [
      "needs-input",
      "input",
      "question",
      "blocked",
      "needs-you",
      "attention",
    ].includes(key)
  )
    return "needs-input";
  if (["error", "failed", "failure", "cannot", "refused"].includes(key))
    return "error";
  return null;
}

const ERROR_WORDS =
  /\b(error|erro|failed|falhou|falha|cannot|can't|couldn't|unable|não consigo|não foi possível|impossível)\b/i;

/**
 * The fallback when the assistant ended its turn without `board_ack`: its reply's first
 * sentence, classified. A question needs the user; failure words are an error; the rest is ok.
 */
export function classifyReply(reply: string): {
  status: AckStatus;
  message: string;
} {
  const text = reply.replace(/<report>[\s\S]*?<\/report>/g, "").trim();
  const firstParagraph = text.split(/\n\s*\n/)[0] ?? text;
  const sentence =
    /^[\s\S]*?[.!?](\s|$)/.exec(firstParagraph)?.[0] ?? firstParagraph;
  const message = oneLine(
    sentence || text || "The assistant answered without text.",
  );
  if (text.includes("?")) {
    const question = /[^.!?\n]*\?/.exec(text)?.[0];
    return { status: "needs-input", message: oneLine(question ?? message) };
  }
  if (ERROR_WORDS.test(firstParagraph)) return { status: "error", message };
  return { status: "ok", message };
}

/** `paseo://h/<serverId>/agent/<agentId>`, the app's agent deep link. */
export function agentLink(
  serverId: string | null,
  agentId: string | null,
): string | null {
  if (!serverId || !agentId) return null;
  return `paseo://h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
}

export function toQuickAck(
  entry: QuickMessage,
  serverId: string | null,
): QuickAck {
  return {
    id: entry.id,
    status: entry.status,
    message:
      entry.message ??
      (entry.status === "pending"
        ? "Sent; waiting for the assistant to confirm."
        : ""),
    agentId: entry.agentId,
    sentAt: entry.sentAt,
    link: agentLink(serverId, entry.agentId),
  };
}
