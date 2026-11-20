// CUSTOM(assistant-reports): strings of the Projects Reports page, in English and Brazilian
// Portuguese. Chinese falls back to English.
import type { HistoryEventKind } from "../../shared/assistant";
import type { ReportEntryKind } from "../../shared/assistant-reports";
import type { PageLocale } from "../paseo-language";

/** The labels of the question and review-map pieces (client/assistant/card-parts.tsx). */
export interface CardLabels {
  whatYouAsked: string;
  evidence: { seen: string; tested: string; unverified: string };
  notDoneKind: { skipped: string; unverified: string; outside: string };
  recommended: string;
  why: string;
  pick: string;
  sent: string;
  sending: string;
  comment: string;
  commentPlaceholder: string;
  send: string;
  cancel: string;
  gains: string;
  costs: string;
  sendFailed: string;
  byUser: string;
  byAssistant: string;
}

const en = {
  title: "Reports",
  searchPlaceholder: "Search tickets",
  clearSearch: "Clear search",
  allProjects: "All projects",
  noTickets:
    "No tickets yet. Tickets appear here once the Project Manager or the board acts on them.",
  noMatches: "No ticket matches your search.",
  statusFilterHidesAll:
    "The status filter hides every ticket. Turn on more statuses above.",
  statusFilter: "Show status",
  nothingSelected: "Select a ticket to read its report.",
  loading: "Loading…",
  loadFailed: "Could not load the reports.",
  back: "Back",
  removedFromBoard: "removed from the board",
  showMore: "Show more",
  showLess: "Show less",
  asked: "What was asked",
  decisions: "Decisions",
  details: "Details",
  automaticEvents: "Automatic events",
  noTimeline: "Nothing was recorded for this ticket.",
  interaction: "Interaction with the agent",
  prompt: "Asked",
  answer: "Answer",
  report: "Report",
  summary: "Summary",
  risks: "Risks",
  question: "Question",
  checks: "Checks",
  filesChanged: "Files changed", // CUSTOM(report-card)
  waitingFor: "Waiting for", // CUSTOM(task-checkpoints)
  resumes: "resumes", // CUSTOM(task-checkpoints)
  openConversation: "Open conversation",
  sourceAssistant: "Project Manager",
  sourceAuto: "automatic",
  ago: { now: "now", m: "m ago", h: "h ago", d: "d ago" },
  // CUSTOM(assistant-cards): the question and review-map pieces of the report cards.
  card: {
    whatYouAsked: "What you asked",
    evidence: { seen: "seen", tested: "tested", unverified: "unverified" },
    notDoneKind: {
      skipped: "skipped",
      unverified: "not verified",
      outside: "outside the ask",
    },
    recommended: "recommended",
    why: "Why",
    pick: "Answer with this option",
    sent: "sent",
    sending: "Sending…",
    comment: "Comment on this item",
    commentPlaceholder: "What should change here?",
    send: "Send",
    cancel: "Cancel",
    gains: "gains",
    costs: "costs",
    sendFailed: "Could not send.",
    byUser: "you",
    byAssistant: "Project Manager",
  },
  reportStatus: {
    done: "Done",
    blocked: "Blocked",
    needs_input: "Needs input",
    failed: "Failed",
    checkpoint: "Checkpoint", // CUSTOM(task-checkpoints)
  } as Record<string, string>,
  entryKind: {
    created: "Created",
    started: "Started",
    moved: "Moved",
    reviewed: "Reviewed",
    feedback: "Feedback",
    answered: "Answered",
    fixed: "Fixed",
    merged: "Merged",
    escalated: "Escalated",
    note: "Note",
  } satisfies Record<ReportEntryKind, string>,
  eventKind: {
    "task-created": "Task created",
    "task-moved": "Task moved",
    "task-started": "Task started",
    "task-continued": "Task continued",
    report: "Agent report",
    checkpoint: "Checkpoint", // CUSTOM(task-checkpoints)
    "usage-limit": "Paused by the usage limit", // CUSTOM(usage-limit)
    "verify-passed": "Checks passed",
    "verify-failed": "Checks failed",
    "fix-requested": "Fix requested",
    "waiting-clean": "Waiting for a clean checkout",
    committed: "Committed",
    merged: "Merged",
    "pr-prepared": "Pull request prepared",
    "needs-you": "Needs you",
    "told-assistant": "Told the Project Manager",
    "chat-compacted": "Chat compacted", // CUSTOM(assistant-compact)
    "chat-compact-failed": "Chat compaction failed", // CUSTOM(assistant-compact)
    observed: "Observed",
    failed: "Failed",
    done: "Done",
    dismissed: "Dismissed",
  } satisfies Record<HistoryEventKind, string>,
};
export type ReportsStrings = typeof en;

const pt: ReportsStrings = {
  title: "Relatórios",
  searchPlaceholder: "Buscar tickets",
  clearSearch: "Limpar busca",
  allProjects: "Todos os projetos",
  noTickets:
    "Nenhum ticket ainda. Os tickets aparecem aqui quando o Project Manager ou o quadro agir sobre eles.",
  noMatches: "Nenhum ticket corresponde à busca.",
  statusFilterHidesAll:
    "O filtro de status escondeu todos os tickets. Marque mais status acima.",
  statusFilter: "Mostrar status",
  nothingSelected: "Selecione um ticket para ler o relatório.",
  loading: "Carregando…",
  loadFailed: "Não foi possível carregar os relatórios.",
  back: "Voltar",
  removedFromBoard: "removido do quadro",
  showMore: "Mostrar mais",
  showLess: "Mostrar menos",
  asked: "O que foi pedido",
  decisions: "Decisões",
  details: "Detalhes",
  automaticEvents: "Eventos automáticos",
  noTimeline: "Nada foi registrado para este ticket.",
  interaction: "Interação com o agente",
  prompt: "Pedido",
  answer: "Resposta",
  report: "Relatório",
  summary: "Resumo",
  risks: "Riscos",
  question: "Pergunta",
  checks: "Verificações",
  filesChanged: "Arquivos alterados", // CUSTOM(report-card)
  waitingFor: "Aguardando", // CUSTOM(task-checkpoints)
  resumes: "retoma", // CUSTOM(task-checkpoints)
  openConversation: "Abrir conversa",
  sourceAssistant: "Project Manager",
  sourceAuto: "automático",
  ago: { now: "agora", m: " min atrás", h: " h atrás", d: " d atrás" },
  card: {
    whatYouAsked: "O que você pediu",
    evidence: { seen: "visto", tested: "testado", unverified: "sem prova" },
    notDoneKind: {
      skipped: "pulado",
      unverified: "não verificado",
      outside: "fora do pedido",
    },
    recommended: "recomendado",
    why: "Por quê",
    pick: "Responder com esta opção",
    sent: "enviado",
    sending: "Enviando…",
    comment: "Comentar este item",
    commentPlaceholder: "O que mudar aqui?",
    send: "Enviar",
    cancel: "Cancelar",
    gains: "ganha",
    costs: "custa",
    sendFailed: "Não foi possível enviar.",
    byUser: "você",
    byAssistant: "Project Manager",
  },
  reportStatus: {
    done: "Concluído",
    blocked: "Bloqueado",
    needs_input: "Precisa de resposta",
    failed: "Falhou",
    checkpoint: "Ponto de controle", // CUSTOM(task-checkpoints)
  },
  entryKind: {
    created: "Criado",
    started: "Iniciado",
    moved: "Movido",
    reviewed: "Revisado",
    feedback: "Feedback",
    answered: "Respondido",
    fixed: "Corrigido",
    merged: "Mesclado",
    escalated: "Escalado",
    note: "Nota",
  },
  eventKind: {
    "task-created": "Tarefa criada",
    "task-moved": "Tarefa movida",
    "task-started": "Tarefa iniciada",
    "task-continued": "Tarefa continuada",
    report: "Relatório do agente",
    checkpoint: "Ponto de controle", // CUSTOM(task-checkpoints)
    "usage-limit": "Pausada pelo limite de uso", // CUSTOM(usage-limit)
    "verify-passed": "Verificações passaram",
    "verify-failed": "Verificações falharam",
    "fix-requested": "Correção solicitada",
    "waiting-clean": "Aguardando checkout limpo",
    committed: "Commit feito",
    merged: "Mesclado",
    "pr-prepared": "Pull request preparado",
    "needs-you": "Precisa de você",
    "told-assistant": "Avisou o Project Manager",
    "chat-compacted": "Chat compactado", // CUSTOM(assistant-compact)
    "chat-compact-failed": "Falha ao compactar o chat", // CUSTOM(assistant-compact)
    observed: "Observado",
    failed: "Falhou",
    done: "Concluído",
    dismissed: "Dispensado",
  },
};

export function reportsStrings(locale: PageLocale): ReportsStrings {
  return locale === "pt" ? pt : en;
}
