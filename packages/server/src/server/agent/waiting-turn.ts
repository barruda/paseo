import { z } from "zod";

// CUSTOM(waiting-turn-judge): an agent's turn can end on "I'll wait for the build, I'll tell you
// when it's done". Nothing is ready to review then, so the agent must not be marked finished.
// The code scores the closing words; only a score it can't call goes to the metadata model.

/** Only the closing words say whether the agent is waiting; a long report may quote "I'll wait". */
const TAIL_CHARS = 500;
const JUDGE_CHARS = 1500;

export type WaitingTurnVerdict = "waiting" | "done" | "unsure";

export interface WaitingTurnScore {
  verdict: WaitingTurnVerdict;
  waiting: number;
  done: number;
}

// Waiting on something that ends by itself (build, background job, notification). Waiting on the
// user ("vou esperar sua resposta") is a message the user should read, so it scores nothing.
const STRONG_WAITING: readonly RegExp[] = [
  /\b(?:vou|irei|v[aã]o)\s+(?:esperar|aguardar)\b(?!\s+(?:voc[eê]|sua|seu|suas|seus|o seu|a sua|sua resposta|a tua)\b)/i,
  /\bte\s+(?:aviso|notifico|chamo|aviso depois|aviso assim)\b/i,
  /\b(?:aviso|notifico|volto)\s+(?:voc[eê]\s+)?(?:assim que|quando|aqui assim que|aqui quando)\b/i,
  /\baguardando\s+(?:a\s+|o\s+|as\s+|os\s+)?(?:notifica|conclus|t[eé]rmino|build|compila|execu|processo|job|subagente|agente)/i,
  /\bnotifica[cç][aã]o\s+(?:em\s+segundo\s+plano|do\s+background|de\s+background)\b/i,
  /\bI['’]?ll\s+(?:wait|hold off|check back|report back|ping you|tell you)\b/i,
  /\bI\s+will\s+(?:wait|check back|report back|notify you|let you know)\b/i,
  /\bI['’]?ll\s+let\s+you\s+know\s+(?:when|once|as soon as)\b/i,
  /\b(?:waiting|waiting on|waiting for)\s+(?:the\s+)?(?:background|build|notification|job|process|task|subagent|agent|install|deploy)/i,
  /\bwill\s+(?:notify|ping|tell)\s+you\s+(?:when|once)\b/i,
];

const WEAK_WAITING: readonly RegExp[] = [
  /\bassim que\s+(?:ele\s+|ela\s+|isso\s+|o\s+\w+\s+)?(?:terminar|concluir|finalizar|acabar|ficar pronto)\b/i,
  /\bquando\s+(?:ele\s+|ela\s+|isso\s+)?(?:terminar|concluir|finalizar|acabar)\b/i,
  /\b(?:ainda\s+)?(?:est[aá]|segue|continua)\s+(?:rodando|em andamento|em execu[cç][aã]o|buildando|compilando)\b/i,
  /\b(?:once|when|as soon as)\s+(?:it|that|the \w+)\s+(?:finishes|completes|is done|is ready)\b/i,
  /\bstill\s+(?:running|building|in progress|working|installing)\b/i,
  /\b(?:is|are)\s+(?:still\s+)?(?:running|building)\b/i,
  /\b(?:is|at)\s+\d{1,3}\s?%/i,
];

// The agent says the work is complete, or hands the user a question.
const DONE: readonly RegExp[] = [
  /\b(?:pronto|conclu[ií]d[oa]s?|finalizad[oa]s?|tudo certo|feito|terminei|implementei|corrigi|resolvido)\b/i,
  /\b(?:done|finished|completed|implemented|fixed|resolved|all set|ready for review)\b/i,
  /\?\s*$/,
];

function countMatches(patterns: readonly RegExp[], text: string): number {
  return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
}

/**
 * Scores the closing words of an agent's last message. `waiting`: it says it is waiting on
 * something that will resume its work. `done`: it says nothing of the kind. `unsure`: waiting
 * words and done words mixed, or only weak waiting words; the caller may ask a model.
 */
export function scoreWaitingTurn(message: string): WaitingTurnScore {
  const tail = message.trim().slice(-TAIL_CHARS);
  const waiting = countMatches(STRONG_WAITING, tail) * 2 + countMatches(WEAK_WAITING, tail);
  const done = countMatches(DONE, tail);
  if (waiting === 0) return { verdict: "done", waiting, done };
  if (waiting >= 2 && done === 0) return { verdict: "waiting", waiting, done };
  return { verdict: "unsure", waiting, done };
}

export const WaitingTurnJudgmentSchema = z.object({
  waiting: z
    .boolean()
    .describe(
      "True when the agent says it is still waiting on something and has nothing to review.",
    ),
});

export function buildWaitingTurnJudgePrompt(message: string): string {
  const tail = message.trim().slice(-JUDGE_CHARS);
  return [
    "You judge the last message a coding agent wrote before its turn ended.",
    "Decide whether the agent is still waiting on something that will resume its work: a build, a background job, a subagent, a download, or a notification it says it will act on.",
    "In that case nothing is ready for the user to review yet: waiting is true.",
    "If the agent finished its work, reports a result, or asks the user a question or for a decision, waiting is false.",
    "The message may be in Portuguese or English.",
    "Return JSON only with a single field 'waiting'.",
    "",
    "Last message:",
    tail,
  ].join("\n");
}

/** Asks a fast model whether the turn ended waiting. Throws when the model can't answer. */
export type WaitingTurnJudge = (input: { cwd: string; message: string }) => Promise<boolean>;
