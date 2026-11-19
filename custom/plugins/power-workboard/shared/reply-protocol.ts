// CUSTOM(assistant-reply-protocol): the short `pwb` block the Projects Assistant ends each reply
// with, and its parser. The protocol is described in docs/assistant-reply-protocol.md; the keys
// and enums below are its source of truth (a test checks the doc lists the same values).
import { z } from "zod";

export const REPLY_PROTOCOL_VERSION = 1;
/** The fence language of the block: ```pwb. */
export const REPLY_FENCE = "pwb";

/** The keys, in the order the block writes them. */
export const REPLY_KEYS = [
  "feito",
  "aviso",
  "bloqueio",
  "próximo",
  "seu",
] as const;
export type ReplyKey = (typeof REPLY_KEYS)[number];

/** The verbs a `feito` line starts with, aligned with board_report's kinds. */
export const DONE_VERBS = [
  "merge",
  "revisão",
  "feedback",
  "criei",
  "iniciei",
  "movi",
  "corrigi",
  "respondi",
  "escalei",
  "nota",
] as const;
export type DoneVerb = (typeof DONE_VERBS)[number];

/** Who moves next. */
export const NEXT_VALUES = [
  "sigo",
  "agente",
  "revisão",
  "você",
  "espera",
  "fim",
] as const;
export type NextValue = (typeof NEXT_VALUES)[number];

/** The `seu` value that means the user has nothing to do. */
export const YOURS_NONE = "nada";

/** Lowercase without accents, so "Proximo", "próximo" and "PRÓXIMO" match. */
export function normalizeWord(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

function lookup<T extends string>(
  values: readonly T[],
  word: string,
): T | null {
  const normalized = normalizeWord(word);
  return values.find((value) => normalizeWord(value) === normalized) ?? null;
}

/**
 * A trailing `[id]`: a task id's first 8 hex characters or the whole UUID. Nothing else, so a
 * bracketed date or commit hash stays text.
 */
const TRAILING_ID =
  /\s*\[([0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)\]\s*$/i;

/** Splits the trailing `[id]` groups off a value. */
export function splitTaskIds(value: string): { text: string; ids: string[] } {
  const ids: string[] = [];
  let text = value;
  for (
    let match = TRAILING_ID.exec(text);
    match;
    match = TRAILING_ID.exec(text)
  ) {
    ids.unshift(match[1].toLowerCase());
    text = text.slice(0, match.index);
  }
  return { text: text.trim(), ids };
}

export interface ReplyLine {
  /** The text without the verb and the ids. */
  text: string;
  /** Task ids written as `[id]` at the end of the line. */
  taskIds: string[];
}

export interface DoneLine extends ReplyLine {
  /** Null when the first word is not one of DONE_VERBS: `text` then keeps the whole value. */
  verb: DoneVerb | null;
}

export interface ParsedReply {
  done: DoneLine[];
  warnings: ReplyLine[];
  blockers: ReplyLine[];
  /** `value` is null when the word is not one of NEXT_VALUES; `text` keeps what was written. */
  next: { value: NextValue | null; text: string } | null;
  /** `none` when the value is `nada` (or empty). */
  yours: (ReplyLine & { none: boolean }) | null;
  /** Unknown keys and lines without a key, shown as plain text. */
  extra: { key: string | null; text: string }[];
  /** Markdown after a `---` line inside the block. */
  details: string;
}

/** Parses the lines of a `pwb` block (without its fences). Never throws. */
export function parseReplyBlock(body: string): ParsedReply {
  const reply: ParsedReply = {
    done: [],
    warnings: [],
    blockers: [],
    next: null,
    yours: null,
    extra: [],
    details: "",
  };
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index].trim();
    if (!raw) continue;
    if (/^-{3,}$/.test(raw)) {
      reply.details = lines
        .slice(index + 1)
        .join("\n")
        .trim();
      break;
    }
    // A list marker the model may copy from the prompt ("- feito: ...") is not part of the key.
    const line = raw.replace(/^(?:[-*•]|\d+[.)])\s+/, "");
    const match = /^([^:]+?)\s*:\s*(.*)$/.exec(line);
    const key = match ? lookup(REPLY_KEYS, match[1]) : null;
    if (!match || !key) {
      reply.extra.push({
        key: match ? match[1].trim() : null,
        text: match ? match[2].trim() : line,
      });
      continue;
    }
    const value = match[2].trim();
    const { text, ids } = splitTaskIds(value);
    if (key === "feito") {
      const [first = "", ...rest] = text.split(/\s+/);
      const verb = lookup(DONE_VERBS, first);
      reply.done.push({
        verb,
        text: verb ? rest.join(" ") : text,
        taskIds: ids,
      });
    } else if (key === "aviso") {
      reply.warnings.push({ text, taskIds: ids });
    } else if (key === "bloqueio") {
      reply.blockers.push({ text, taskIds: ids });
    } else if (key === "próximo") {
      reply.next = { value: lookup(NEXT_VALUES, text), text };
    } else {
      const none = text === "" || normalizeWord(text) === YOURS_NONE;
      reply.yours = { none, text: none ? YOURS_NONE : text, taskIds: ids };
    }
  }
  return reply;
}

export interface ReplySplit {
  /** The reply before the block, trimmed: the direct answer, shown as Markdown. */
  before: string;
  reply: ParsedReply;
  /** The reply after the block, trimmed: it goes into the details. */
  after: string;
}

/**
 * Every closed ```pwb block. Both fences start a line, at most 3 spaces in, as in Markdown; the
 * closing one may be longer than the opening one.
 */
const BLOCK =
  /^ {0,3}(`{3,}|~{3,})[ \t]*pwb[ \t]*\r?\n(?:([\s\S]*?)\r?\n)? {0,3}\1[`~]*[ \t]*$/gim;

/** True when `index` falls inside an earlier fenced code block (a block quoted in code). */
function insideFence(text: string, index: number): boolean {
  const fences = text.slice(0, index).match(/^ {0,3}(```|~~~)/gm);
  return (fences?.length ?? 0) % 2 === 1;
}

/** Splits a reply around its last closed `pwb` block; null when it has none. */
export function splitReply(text: string): ReplySplit | null {
  let last: RegExpExecArray | null = null;
  for (const match of text.matchAll(BLOCK)) {
    if (!insideFence(text, match.index)) last = match;
  }
  if (!last) return null;
  return {
    before: text.slice(0, last.index).trim(),
    reply: parseReplyBlock(last[2] ?? ""),
    after: text.slice(last.index + last[0].length).trim(),
  };
}

export const REPLY_ITEM_KIND = "assistant-reply";
export const REPLY_ITEM_VERSION = 1;

/**
 * The item keeps the whole reply: the renderer parses it, and shows it unchanged when the agent is
 * not the Projects Assistant (the transformer cannot tell which agent wrote it).
 */
export const replyItemDataSchema = z.object({ text: z.string() });
export type ReplyItemData = z.infer<typeof replyItemDataSchema>;

export interface ReplyTimelineItem {
  type: "plugin";
  kind: string;
  version: number;
  data: ReplyItemData;
}

/** The item that replaces a reply ending in a `pwb` block; undefined keeps the reply as it is. */
/** The label the server's `CHAT_LABEL` puts on the Projects Assistant's chat agent. */
export const ASSISTANT_CHAT_AGENT_LABEL = "pwb/assistant-chat";

/**
 * The item that replaces a reply ending in a `pwb` block, only in the Projects Assistant's chat.
 * `labels` are the chat agent's, which hosts without CUSTOM(timeline-transformer-agent) don't
 * pass: the reply then stays as is.
 */
export function replyTimelineItems(
  text: string,
  labels: Readonly<Record<string, string>> | undefined,
): ReplyTimelineItem[] | undefined {
  if (labels?.[ASSISTANT_CHAT_AGENT_LABEL] !== "true") return undefined;
  if (!splitReply(text)) return undefined;
  return [
    {
      type: "plugin",
      // No id: the host keys a plugin item by its own id as is, so a fixed one would collide
      // across replies; without one it uses the source message's id.
      kind: REPLY_ITEM_KIND,
      version: REPLY_ITEM_VERSION,
      data: { text },
    },
  ];
}

/** The details expander's Markdown: the block's `---` part, then the text after the block. */
export function replyDetails(split: ReplySplit): string {
  return [split.reply.details, split.after].filter(Boolean).join("\n\n");
}

/** Short form of a task id for labels: its first 8 characters. */
export function shortTaskId(id: string): string {
  return id.slice(0, 8);
}

export type ReplyTone = "success" | "warning" | "danger" | "info" | "muted";

/** The Lucide icon of each `feito` verb; an unknown verb gets a plain check. */
export const DONE_VERB_ICON: Record<DoneVerb, string> = {
  merge: "GitMerge",
  revisão: "SearchCheck",
  feedback: "MessageSquare",
  criei: "SquarePlus",
  iniciei: "Play",
  movi: "ArrowRightLeft",
  corrigi: "Wrench",
  respondi: "Reply",
  escalei: "CircleArrowUp",
  nota: "StickyNote",
};
export const DONE_FALLBACK_ICON = "Check";

/** Icon and tone of the `próximo` chip; an unknown value gets the last entry's look. */
export const NEXT_LOOK: Record<
  NextValue | "other",
  { icon: string; tone: ReplyTone }
> = {
  sigo: { icon: "RotateCw", tone: "info" },
  agente: { icon: "Bot", tone: "info" },
  revisão: { icon: "Eye", tone: "info" },
  você: { icon: "UserRound", tone: "warning" },
  espera: { icon: "Hourglass", tone: "muted" },
  fim: { icon: "CircleCheckBig", tone: "success" },
  other: { icon: "Circle", tone: "muted" },
};
