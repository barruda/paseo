// CUSTOM(assistant-cards): the text a card sends when the user answers in one tap or leaves
// feedback on one item. The chat card sends it to the Project Manager as a message; the report
// cards send it as the task's Continue feedback. One format for both, so either reader sees which
// option or item it is about.

const quote = (text: string) => `"${text.replace(/\s+/g, " ").trim()}"`;

/** The answer when the user picks an option. */
export function optionAnswer(
  question: string,
  option: { id: string; label: string },
): string {
  const choice = `${option.id} (${option.label.trim()})`;
  return question.trim()
    ? `Resposta a ${quote(question)}: escolho ${choice}.`
    : `Escolho ${choice}.`;
}

/** Feedback on one item of a card: an outcome, a step, a line of what was done. */
export function itemFeedback(item: string, feedback: string): string {
  return `Sobre ${quote(item)}: ${feedback.trim()}`;
}
