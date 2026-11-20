// CUSTOM(assistant-reply-protocol): the short `pwb` block the Project Manager ends each reply
// with, and its parser. The protocol is described in docs/assistant-reply-protocol.md; the keys
// and enums below are its source of truth (a test checks the doc lists the same values).
import { z } from "zod";
import { type EvidenceKind, type NotDoneKind } from "./assistant";

// CUSTOM(assistant-cards): v2 adds the review map (`pedido`, `fora`) and structured questions
// (`pergunta`, `opção`, `recomendo`). v1 blocks have none of them and parse as before.
// CUSTOM(pm-board): v3 adds `[pm:<card id>]` at the end of a line, for a card on the Project
// Manager's own board. A bare `[<task id>]` still opens the task.
export const REPLY_PROTOCOL_VERSION = 3;
/** The fence language of the block: ```pwb. */
export const REPLY_FENCE = "pwb";

/** The keys, in the order the block writes them. */
export const REPLY_KEYS = [
  "feito",
  "pedido",
  "fora",
  "aviso",
  "bloqueio",
  "pergunta",
  "opção",
  "recomendo",
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

/**
 * One line per `próximo` value, shown in the chip's legend. The protocol doc lists the same
 * lines; a test compares them, so change both together.
 */
export const NEXT_DESCRIPTIONS: Record<NextValue, string> = {
  sigo: "I carry on by myself.",
  agente: "it went back to the task's agent.",
  revisão: "an independent reviewer is looking at it.",
  você: "stopped, waiting for the user.",
  espera: "waiting on something outside (a limit, CI, a time).",
  fim: "delivered, nothing pending.",
};

/**
 * The evidence word a `pedido` line starts with. The canonical words are the report's
 * EVIDENCE_KINDS; the Portuguese ones are aliases.
 */
export const EVIDENCE_WORDS: Readonly<Record<string, EvidenceKind>> = {
  seen: "seen",
  visto: "seen",
  tested: "tested",
  testado: "tested",
  unverified: "unverified",
  "nao verificado": "unverified",
  "sem prova": "unverified",
};

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

/** A trailing `[pm:<card id>]`: a card on the Project Manager's own board. */
const TRAILING_PM_ID = /\s*\[pm:([a-z0-9][a-z0-9-]{0,39})\]\s*$/i;

/**
 * Splits the trailing `[id]` and `[pm:<id>]` groups off a value. A task id is the first 8 hex
 * characters or the whole UUID; a PM card id is written with the `pm:` prefix. Anything else
 * bracketed (a date, a commit hash) stays text.
 */
export function splitReplyIds(value: string): {
  text: string;
  taskIds: string[];
  pmCardIds: string[];
} {
  const taskIds: string[] = [];
  const pmCardIds: string[] = [];
  let text = value;
  for (;;) {
    const pm = TRAILING_PM_ID.exec(text);
    if (pm) {
      pmCardIds.unshift(pm[1].toLowerCase());
      text = text.slice(0, pm.index);
      continue;
    }
    const match = TRAILING_ID.exec(text);
    if (!match) break;
    taskIds.unshift(match[1].toLowerCase());
    text = text.slice(0, match.index);
  }
  return { text: text.trim(), taskIds, pmCardIds };
}

export interface ReplyLine {
  /** The text without the verb and the ids. */
  text: string;
  /** Task ids written as `[id]` at the end of the line. */
  taskIds: string[];
  /** PM board card ids written as `[pm:<id>]` at the end of the line. */
  pmCardIds: string[];
}

export interface DoneLine extends ReplyLine {
  /** Null when the first word is not one of DONE_VERBS: `text` then keeps the whole value. */
  verb: DoneVerb | null;
}

/** A `pedido` line: what the user asked for, quoted, and how it was checked. */
export interface OutcomeLine extends ReplyLine {
  /** `unverified` when the line names no evidence word. */
  evidence: EvidenceKind;
  /** The proof: the command and what it showed, or the test's name. */
  detail: string;
}

/** A `fora` line: changed without being asked, the report's `notDone` of kind `outside`. */
export interface NotDoneLine extends ReplyLine {
  kind: NotDoneKind;
}

/** An `opção` line. */
export interface ReplyOption {
  id: string;
  label: string;
  gains: string | null;
  costs: string | null;
}

/** `pergunta` with its `opção` lines and `recomendo`. */
export interface ReplyQuestion {
  /** Empty when the block has options but no `pergunta` line. */
  text: string;
  taskIds: string[];
  pmCardIds: string[];
  options: ReplyOption[];
  /** The recommended option's id, when it names one of the options. */
  recommend: string | null;
  why: string | null;
}

export interface ParsedReply {
  done: DoneLine[];
  /** CUSTOM(assistant-cards): the review map. */
  outcomes: OutcomeLine[];
  notDone: NotDoneLine[];
  warnings: ReplyLine[];
  blockers: ReplyLine[];
  /** `value` is null when the word is not one of NEXT_VALUES; `text` keeps what was written. */
  next: { value: NextValue | null; text: string } | null;
  /** `none` when the value is `nada` (or empty). */
  yours: (ReplyLine & { none: boolean }) | null;
  /** CUSTOM(assistant-cards): null when the block has no `pergunta` and no `opção`. */
  question: ReplyQuestion | null;
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
    question: null,
    extra: [],
    details: "",
    outcomes: [],
    notDone: [],
  };
  let question: {
    text: string;
    taskIds: string[];
    pmCardIds: string[];
  } | null = null;
  const options: ReplyOption[] = [];
  let recommend: { id: string; why: string | null } | null = null;
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
    const { text, taskIds: ids, pmCardIds } = splitReplyIds(value);
    if (key === "opção") {
      const option = parseOption(value);
      if (option && !options.some((o) => o.id === option.id))
        options.push(option);
      else reply.extra.push({ key: match[1].trim(), text: value });
      continue;
    }
    if (key === "recomendo") {
      const [id = "", ...why] = splitFields(value);
      recommend = { id, why: why.join(" | ") || null };
      continue;
    }
    if (key === "pergunta") {
      question = { text, taskIds: ids, pmCardIds };
      continue;
    }
    if (key === "pedido") {
      reply.outcomes.push(parseOutcome(text, ids, pmCardIds));
      continue;
    }
    if (key === "fora") {
      reply.notDone.push({ kind: "outside", text, taskIds: ids, pmCardIds });
      continue;
    }
    if (key === "feito") {
      const [first = "", ...rest] = text.split(/\s+/);
      const verb = lookup(DONE_VERBS, first);
      reply.done.push({
        verb,
        text: verb ? rest.join(" ") : text,
        taskIds: ids,
        pmCardIds,
      });
    } else if (key === "aviso") {
      reply.warnings.push({ text, taskIds: ids, pmCardIds });
    } else if (key === "bloqueio") {
      reply.blockers.push({ text, taskIds: ids, pmCardIds });
    } else if (key === "próximo") {
      reply.next = { value: lookup(NEXT_VALUES, text), text };
    } else {
      const none = text === "" || normalizeWord(text) === YOURS_NONE;
      reply.yours = {
        none,
        text: none ? YOURS_NONE : text,
        taskIds: ids,
        pmCardIds,
      };
    }
  }
  if (question || options.length) {
    const known = recommend && options.some((o) => o.id === recommend.id);
    reply.question = {
      text: question?.text ?? "",
      taskIds: question?.taskIds ?? [],
      pmCardIds: question?.pmCardIds ?? [],
      options,
      recommend: known ? recommend!.id : null,
      why: known ? recommend!.why : null,
    };
  }
  return reply;
}

/** The `|`-separated fields of a value, trimmed, without empty ones. */
function splitFields(value: string): string[] {
  return value
    .split("|")
    .map((field) => field.trim())
    .filter(Boolean);
}

/** A field written as `ganha: x` or `custa: x`; null for any other field. */
function labeledField(
  field: string,
): { key: "gains" | "costs"; text: string } | null {
  const match = /^([^:]+):\s*(.*)$/.exec(field);
  if (!match) return null;
  const word = normalizeWord(match[1]);
  if (word === "ganha" || word === "gains")
    return { key: "gains", text: match[2].trim() };
  if (word === "custa" || word === "costs")
    return { key: "costs", text: match[2].trim() };
  return null;
}

/** `<id> | <label> | ganha: <x> | custa: <y>`; null without an id and a label. */
function parseOption(value: string): ReplyOption | null {
  const [id, ...rest] = splitFields(value);
  if (!id || /\s/.test(id) || id.length > 40) return null;
  const option: ReplyOption = { id, label: "", gains: null, costs: null };
  const label: string[] = [];
  for (const field of rest) {
    const labeled = labeledField(field);
    if (labeled) option[labeled.key] = labeled.text || null;
    else label.push(field);
  }
  option.label = label.join(" | ");
  return option.label ? option : null;
}

/** `<evidence> | <the ask> | <proof>`; without an evidence word the whole text is the ask. */
function parseOutcome(
  text: string,
  taskIds: string[],
  pmCardIds: string[],
): OutcomeLine {
  const fields = splitFields(text);
  const evidence = fields.length
    ? EVIDENCE_WORDS[normalizeWord(fields[0]).replace(/[-_]/g, " ")]
    : undefined;
  if (!evidence)
    return { evidence: "unverified", text, detail: "", taskIds, pmCardIds };
  const [, ask = "", ...proof] = fields;
  return {
    evidence,
    text: unquote(ask),
    detail: proof.join(" | "),
    taskIds,
    pmCardIds,
  };
}

/** The ask without the quotes around it: the card adds its own. */
function unquote(text: string): string {
  const match = /^["“'](.*)["”']$/.exec(text);
  return match ? match[1].trim() : text;
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
 * The item keeps the whole reply: the renderer parses it again to draw the text before the block
 * and the card, and shows the text unchanged if it no longer parses.
 */
export const replyItemDataSchema = z.object({ text: z.string() });
export type ReplyItemData = z.infer<typeof replyItemDataSchema>;

export interface ReplyTimelineItem {
  type: "plugin";
  kind: string;
  version: number;
  data: ReplyItemData;
}

/** The label the server's `CHAT_LABEL` puts on the Project Manager's chat agent. */
export const ASSISTANT_CHAT_AGENT_LABEL = "pwb/assistant-chat";

/**
 * CUSTOM(assistant-compact-follow): the app label (AGENT_REPLACES_LABEL in
 * packages/app/src/task-navigation/agent-successor.ts) naming the chat a compacted chat replaces.
 * The app moves the old chat's tabs and composer draft to the new chat when the old one is archived.
 */
export const AGENT_REPLACES_LABEL = "paseo.replaces-agent";

/**
 * The item that replaces a reply ending in a `pwb` block, only in the Project Manager's chat.
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

/** One row of the `próximo` chip's legend. */
export interface NextLegendEntry {
  value: NextValue;
  icon: string;
  tone: ReplyTone;
  description: string;
  /** True for the value the chip shows, so the legend can highlight it. */
  current: boolean;
}

/** The legend behind the `próximo` chip: every value in enum order, the current one flagged. */
export function nextLegend(current: NextValue | null): NextLegendEntry[] {
  return NEXT_VALUES.map((value) => ({
    value,
    ...NEXT_LOOK[value],
    description: NEXT_DESCRIPTIONS[value],
    current: value === current,
  }));
}
