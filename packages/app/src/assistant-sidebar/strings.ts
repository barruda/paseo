// CUSTOM(assistant-desk-newest): strings of the archived callout's "go to the new session" branch.
// Kept out of the locale files; pt-BR when the UI language starts with "pt", else English.
export interface AssistantDeskStrings {
  compacted: string;
  ended: string;
  goToNew: string;
}

export const assistantDeskStringsEn: AssistantDeskStrings = {
  compacted: "This session ended and was compacted automatically.",
  ended: "This Projects Assistant chat has ended.",
  goToNew: "Go to the new session",
};

export const assistantDeskStringsPtBr: AssistantDeskStrings = {
  compacted: "A sessão foi finalizada e compactada automaticamente.",
  ended: "Esta conversa do Projects Assistant foi encerrada.",
  goToNew: "Ir para a nova sessão",
};

export function assistantDeskStrings(language: string | undefined): AssistantDeskStrings {
  return language?.startsWith("pt") ? assistantDeskStringsPtBr : assistantDeskStringsEn;
}
