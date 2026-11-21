// CUSTOM(assistant-desk-newest), CUSTOM(pm-sidebar): strings of the archived callout's "go to the
// new session" branch and of the right sidebar's Project Manager tab.
// Kept out of the locale files; pt-BR when the UI language starts with "pt", else English.
export interface AssistantDeskStrings {
  compacted: string;
  ended: string;
  goToNew: string;
  /** CUSTOM(pm-sidebar): the right sidebar tab's link to the main area, and its empty state. */
  openInMain: string;
  noChat: string;
  /** CUSTOM(pm-sidebar): the tab while the Project Manager Desk is on screen, and its way back. */
  openedInMain: string;
  showHere: string;
}

export const assistantDeskStringsEn: AssistantDeskStrings = {
  compacted: "This session ended and was compacted automatically.",
  ended: "This Project Manager chat has ended.",
  goToNew: "Go to the new session",
  openInMain: "Open in main area",
  noChat: "No Project Manager chat yet. Open it in the main area to start one.",
  openedInMain: "The Project Manager is open in the main area.",
  showHere: "Show here",
};

export const assistantDeskStringsPtBr: AssistantDeskStrings = {
  compacted: "A sessão foi finalizada e compactada automaticamente.",
  ended: "Esta conversa do Project Manager foi encerrada.",
  goToNew: "Ir para a nova sessão",
  openInMain: "Abrir no conteúdo central",
  noChat: "Ainda não há conversa do Project Manager. Abra no conteúdo central para começar uma.",
  openedInMain: "O Project Manager está aberto no conteúdo central.",
  showHere: "Mostrar aqui",
};

export function assistantDeskStrings(language: string | undefined): AssistantDeskStrings {
  return language?.startsWith("pt") ? assistantDeskStringsPtBr : assistantDeskStringsEn;
}
