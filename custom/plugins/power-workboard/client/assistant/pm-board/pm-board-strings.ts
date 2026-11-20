// CUSTOM(pm-board): strings of the Decisões page, in English and Brazilian Portuguese. Chinese
// falls back to English, as the other Project Manager pages do.
import type { PmCardKind, PmCardStatus } from "../../../shared/pm-board";
import type { PageLocale } from "../../paseo-language";

const en = {
  title: "Project Manager decisions",
  subtitle:
    "Investigations, proposals and decisions between you and the Project Manager. Code tasks and code reviews stay on the Board.",
  loading: "Loading…",
  loadFailed: "Could not load the decisions.",
  retry: "Try again",
  columns: {
    investigating: "Investigating",
    waiting: "Waiting for you",
    decided: "Decided",
    archived: "Archived",
  } satisfies Record<PmCardStatus, string>,
  kinds: {
    investigation: "Investigation",
    proposal: "Proposal",
    decision: "Decision",
    notice: "Notice",
  } satisfies Record<PmCardKind, string>,
  empty: {
    investigating: "Nothing under investigation.",
    waiting: "Nothing waiting for you.",
    decided: "Nothing decided yet.",
    archived: "Nothing archived.",
  } satisfies Record<PmCardStatus, string>,
  question: "Question",
  findings: "Findings",
  decision: "Decision",
  recommended: "recommended",
  gains: "gains",
  costs: "costs",
  answerPlaceholder: "Or write another answer…",
  send: "Answer",
  sending: "Sending…",
  reopen: "Reopen",
  reopening: "Reopening…",
  decidedByUser: "decided by you",
  decidedByPm: "decided by the Project Manager",
  notSent:
    "The decision was recorded, but the Project Manager could not be messaged. Reopen and answer again, or tell it in the chat.",
  openTask: "Open ticket",
  openReport: "Open report",
  showMore: "Show more",
  showLess: "Show less",
  ago: { now: "now", m: "m ago", h: "h ago", d: "d ago" },
};

export type PmBoardStrings = typeof en;

const pt: PmBoardStrings = {
  title: "Decisões do Project Manager",
  subtitle:
    "Investigações, propostas e decisões entre você e o Project Manager. As tarefas de código e as revisões de código ficam no Board.",
  loading: "Carregando…",
  loadFailed: "Não foi possível carregar as decisões.",
  retry: "Tentar de novo",
  columns: {
    investigating: "Investigando",
    waiting: "Esperando você",
    decided: "Decidido",
    archived: "Arquivado",
  },
  kinds: {
    investigation: "Investigação",
    proposal: "Proposta",
    decision: "Decisão",
    notice: "Aviso",
  },
  empty: {
    investigating: "Nada em investigação.",
    waiting: "Nada esperando você.",
    decided: "Nada decidido ainda.",
    archived: "Nada arquivado.",
  },
  question: "Pergunta",
  findings: "Descobertas",
  decision: "Decisão",
  recommended: "recomendado",
  gains: "ganha",
  costs: "custa",
  answerPlaceholder: "Ou escreva outra resposta…",
  send: "Responder",
  sending: "Enviando…",
  reopen: "Reabrir",
  reopening: "Reabrindo…",
  decidedByUser: "decidido por você",
  decidedByPm: "decidido pelo Project Manager",
  notSent:
    "A decisão foi registrada, mas não foi possível avisar o Project Manager. Reabra e responda de novo, ou avise no chat.",
  openTask: "Abrir ticket",
  openReport: "Abrir relatório",
  showMore: "Mostrar mais",
  showLess: "Mostrar menos",
  ago: { now: "agora", m: "min", h: "h", d: "d" },
};

export function pmBoardStrings(locale: PageLocale): PmBoardStrings {
  return locale === "pt" ? pt : en;
}

/** "3m", "2h", "4d"; a card's age since it last changed. */
export function pmAge(
  iso: string,
  now: number,
  t: PmBoardStrings["ago"],
): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const minutes = Math.floor(Math.max(0, now - time) / 60_000);
  if (minutes < 1) return t.now;
  if (minutes < 60) return `${minutes}${t.m}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${t.h}`;
  return `${Math.floor(hours / 24)}${t.d}`;
}
