// CUSTOM(assistant-compact): the text side of the chat's automatic compaction. When a turn leaves
// the Projects Assistant chat at its token limit, the board asks a fork of that chat for a short
// summary of the recent conversation (the question stays out of its history), starts a new chat
// whose first message carries the summary as inherited context, and archives the old one.
import type { TimelineReader } from "../conversations";
import { CHAT_RULES } from "./chat";

/** About 2k tokens. */
export const COMPACT_SUMMARY_MAX_CHARS = 8_000;
/** Replies of the assistant the summary covers, with the user's messages between them. */
export const COMPACT_REPLIES = 3;

export const COMPACT_QUESTION = [
  `This chat is about to be restarted to free context. Write a compact handoff for the next Projects Assistant, covering only your last ${COMPACT_REPLIES} replies and the user's messages between them.`,
  "Include, as short bullet lists: requests still open; decisions taken; tasks mentioned, each with its full id and where it stands; and what you promised the user. Skip what the board or your memory already holds and anything finished that needs no follow-up.",
  `Plain Markdown, no preamble, no pwb block, under 1000 words. Write "Nothing open." when nothing is.`,
].join("\n");

export function clampSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= COMPACT_SUMMARY_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, COMPACT_SUMMARY_MAX_CHARS).trimEnd()}\n[...]`;
}

/**
 * The new chat's first message: its usual rules, then the summary as background. It replies
 * only "ok", so the user does not get a message just because the chat was restarted.
 */
export function compactPrompt(summary: string, fromTokens: number): string {
  return [
    CHAT_RULES,
    "",
    `[Inherited context] The board restarted this chat because the previous one reached ${fromTokens} tokens of context. The summary below is what was going on there. It is background, not a new request: do not act on it now and do not tell the user about the restart. Reply with only \`ok\`, no tools and no pwb block. When the user or the board writes next, carry on from it.`,
    "<inherited-context>",
    clampSummary(summary) || "Nothing open.",
    "</inherited-context>",
  ].join("\n");
}

/**
 * The fallback when the fork cannot answer: the last COMPACT_REPLIES replies and the user's
 * messages between them, read from the timeline and cut to the summary's size.
 */
export async function recentExchange(read: TimelineReader): Promise<string> {
  const page = await read({ direction: "tail", limit: 500 });
  const turns: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const entry of page.entries) {
    const item = entry.item as { type: string; text?: unknown };
    const text = typeof item.text === "string" ? item.text : "";
    if (item.type === "user_message") turns.push({ role: "user", text });
    else if (item.type === "assistant_message") {
      // A reply streams as several rows, split by tool calls: one reply per user message.
      const last = turns.at(-1);
      if (last?.role === "assistant") last.text += text;
      else turns.push({ role: "assistant", text });
    }
  }
  let replies = 0;
  let start = turns.length;
  while (start > 0) {
    if (turns[start - 1]!.role === "assistant") {
      if (replies === COMPACT_REPLIES) break;
      replies++;
    }
    start--;
  }
  const lines = turns
    .slice(start)
    .map(
      (turn) =>
        `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text.trim()}`,
    );
  // Keep the newest end when the excerpt is too long.
  let text = lines.join("\n\n");
  if (text.length > COMPACT_SUMMARY_MAX_CHARS)
    text = `[...]\n${text.slice(text.length - COMPACT_SUMMARY_MAX_CHARS + 6)}`;
  return text;
}
