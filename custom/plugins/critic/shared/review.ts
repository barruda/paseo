import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { isCacheWarmupMessage } from "@getpaseo/protocol/cache-warmup";
import {
  type CriticConfig,
  type CriticReviewData,
  type CriticReviewStatus,
  criticFeedbackRound,
  stripCriticNotice,
} from "@getpaseo/protocol/critic";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Reading the reviewed agent's turn
// ---------------------------------------------------------------------------

export interface ReviewedTurn {
  /** The user's message this loop serves, without a critic notice; null when out of the page. */
  request: string | null;
  /** Everything the agent wrote after the last user message. */
  answer: string;
  /** The last user message (the request, or critic feedback). Identifies the turn. */
  lastUserMessage: string | null;
  /** How many user messages the page holds; changes when the user sends another one. */
  userMessageCount: number;
  /** 1 for an answer to the user; n + 1 for an answer to round n's feedback. */
  round: number;
}

export function readReviewedTurn(items: readonly AgentTimelineItem[]): ReviewedTurn {
  let request: string | null = null;
  let lastUserMessage: string | null = null;
  let userMessageCount = 0;
  let answer = "";
  for (const item of items) {
    if (item.type === "user_message") {
      userMessageCount += 1;
      lastUserMessage = item.text;
      answer = "";
      if (criticFeedbackRound(item.text) === null) request = stripCriticNotice(item.text);
      continue;
    }
    if (item.type === "assistant_message") answer += item.text;
  }
  const feedbackRound = lastUserMessage === null ? null : criticFeedbackRound(lastUserMessage);
  return {
    request,
    answer: answer.trim(),
    lastUserMessage,
    userMessageCount,
    round: feedbackRound === null ? 1 : feedbackRound + 1,
  };
}

/** Turns the critic leaves alone: a cache keep-alive ping is not work for the user. */
export function isReviewableTurn(turn: ReviewedTurn): boolean {
  return turn.lastUserMessage !== null && !isCacheWarmupMessage(turn.lastUserMessage);
}

/** Another user message, or a different last one, means the reviewed turn is no longer current. */
export function isSameTurn(a: ReviewedTurn, b: ReviewedTurn): boolean {
  return a.userMessageCount === b.userMessageCount && a.lastUserMessage === b.lastUserMessage;
}

// ---------------------------------------------------------------------------
// The critic's prompt
// ---------------------------------------------------------------------------

const DEFAULT_INSTRUCTIONS =
  "Judge whether the agent's answer and its work fully and correctly do what the user asked.";

const TOOLS_LINE: Record<CriticConfig["tools"], string> = {
  off: "Do not use any tools. Judge only from what this message carries.",
  read: "You may read files and search the repository to check the work. Never change anything: no edits, no commands that write.",
};

const MAX_REQUEST_CHARS = 20_000;
const MAX_ANSWER_CHARS = 40_000;
export const MAX_DIFF_CHARS = 60_000;

export function fitText(text: string, maxChars: number): string {
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n\n[… cut at ${maxChars} chars]`
    : text;
}

export interface CriticPromptInput {
  config: Pick<CriticConfig, "prompt" | "tools" | "images">;
  turn: Pick<ReviewedTurn, "request" | "answer" | "round">;
  /** null when the diff is off; a note when the workspace is not a git checkout. */
  diff: string | null;
  /** True when this critic already reviewed earlier rounds of the same work. */
  continuing: boolean;
}

export function buildCriticPrompt(input: CriticPromptInput): string {
  const { config, turn } = input;
  const parts: string[] = [];
  parts.push(
    input.continuing
      ? `The agent revised its work after your previous review. This is round ${turn.round}. Review the new answer.`
      : "You are a critic. A coding agent works for a user, and you review each of its answers before the user reads it.",
  );
  parts.push(
    "",
    "<reviewer_instructions>",
    config.prompt.trim() || DEFAULT_INSTRUCTIONS,
    "</reviewer_instructions>",
  );
  if (config.images.length > 0 && !input.continuing) {
    parts.push("The images attached to this message are references from the user for this review.");
  }
  parts.push(
    "",
    "<user_request>",
    turn.request === null
      ? "(The user's request is earlier in the conversation than the agent's history page shows.)"
      : fitText(turn.request, MAX_REQUEST_CHARS),
    "</user_request>",
    "",
    `<agent_answer round="${turn.round}">`,
    turn.answer ? fitText(turn.answer, MAX_ANSWER_CHARS) : "(The agent wrote no text this turn.)",
    "</agent_answer>",
  );
  if (input.diff !== null) {
    parts.push(
      "",
      "<workspace_diff>",
      "Uncommitted changes in the agent's workspace (all of them, not only this turn's):",
      input.diff,
      "</workspace_diff>",
    );
  }
  parts.push(
    "",
    TOOLS_LINE[config.tools],
    "",
    "Write your review, then end your reply with one verdict block, JSON inside the tags:",
    '<verdict>{"verdict": "approved", "feedback": ""}</verdict>',
    "verdict is one of:",
    "- approved: the answer and the work meet the request and the reviewer instructions.",
    "- rejected: something is wrong or missing. feedback lists what the agent must fix, concrete and complete; the agent sees only the feedback.",
    "- question: the agent stopped to ask the user something it needs before going on.",
    "- waiting: the agent says it is waiting on background work (a build, a job) and will go on by itself.",
  );
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// The critic's verdict
// ---------------------------------------------------------------------------

const VerdictSchema = z.object({
  verdict: z.enum(["approved", "rejected", "question", "waiting"]),
  feedback: z.string().optional(),
});
export interface Verdict {
  verdict: z.infer<typeof VerdictSchema>["verdict"];
  feedback: string;
}

const VERDICT_BLOCK = /<verdict>([\s\S]*?)<\/verdict>/g;

/** The last verdict block of the critic's reply, or null when it has none that parses. */
export function parseVerdict(reply: string): Verdict | null {
  const blocks = [...reply.matchAll(VERDICT_BLOCK)];
  for (const block of blocks.toReversed()) {
    try {
      const parsed = VerdictSchema.safeParse(JSON.parse(block[1]?.trim() ?? ""));
      if (parsed.success) {
        return { verdict: parsed.data.verdict, feedback: parsed.data.feedback?.trim() ?? "" };
      }
    } catch {
      // not JSON: try an earlier block
    }
  }
  return null;
}

/** The review text before the verdict block, for when the critic put its points there. */
export function reviewBody(reply: string): string {
  return reply.replace(VERDICT_BLOCK, "").trim();
}

export interface VerdictOutcome {
  status: CriticReviewStatus;
  /** Sent to the agent only when status is "rejected". */
  feedback: string | null;
}

export function verdictOutcome(input: {
  verdict: Verdict;
  reply: string;
  round: number;
  maxRounds: number;
}): VerdictOutcome {
  const { verdict } = input;
  if (verdict.verdict !== "rejected") {
    return { status: verdict.verdict, feedback: verdict.feedback || null };
  }
  const feedback =
    verdict.feedback || reviewBody(input.reply) || "The reviewer rejected the answer.";
  return { status: input.round >= input.maxRounds ? "limit" : "rejected", feedback };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

// The plugin row limit is 64 KiB of JSON.
const MAX_ROW_ANSWER_CHARS = 30_000;
const MAX_ROW_FEEDBACK_CHARS = 16_000;

export function reviewRow(
  base: Omit<CriticReviewData, "answer" | "feedback"> & { answer: string; feedback: string | null },
): CriticReviewData {
  return {
    ...base,
    answer: fitText(base.answer, MAX_ROW_ANSWER_CHARS),
    feedback: base.feedback === null ? null : fitText(base.feedback, MAX_ROW_FEEDBACK_CHARS),
  };
}
