// CUSTOM(tool-cancel): strings for the X on a running tool call and its confirmation. Kept out of
// the big locale files so upstream changes don't conflict. Only English and Brazilian Portuguese
// are translated; the other locales show the English text.

export const TOOL_CANCEL_EN = {
  button: "Cancel tool",
  confirmTitle: "Are you sure?",
  confirmMessage: "This stops the agent's current run, not just this tool.",
  confirmAction: "Stop run",
};

export const TOOL_CANCEL_PT_BR: typeof TOOL_CANCEL_EN = {
  button: "Cancelar tool",
  confirmTitle: "Tem certeza?",
  confirmMessage: "Isso para a execução atual do agente, não só esta tool.",
  confirmAction: "Parar execução",
};
