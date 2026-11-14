// CUSTOM(steer-pending): strings for the pending row under a steered message. Kept out of the
// big locale files so upstream changes don't conflict. Only English and Brazilian Portuguese are
// translated; the other locales show the English text.

export const STEER_PENDING_EN = {
  pending: "pending",
  cancel: "Cancel message",
  interrupt: "Interrupt and send",
};

export const STEER_PENDING_PT_BR: typeof STEER_PENDING_EN = {
  pending: "pendente",
  cancel: "Cancelar mensagem",
  interrupt: "Interromper e enviar",
};
