// CUSTOM(chat-comments): a comment on part of a response is the quoted part followed by the
// comment, added to the end of the composer so the next message carries it.

/** Quotes every line of the excerpt, blank lines included, so the quote stays one block. */
export function formatChatComment(input: { excerpt: string; comment: string }): string {
  const quote = input.excerpt
    .trim()
    .split("\n")
    .map((line) => (line.trim().length > 0 ? `> ${line}` : ">"))
    .join("\n");
  return `${quote}\n\n${input.comment.trim()}`;
}

/** Appends the comment after whatever the composer holds, one blank line apart. */
export function appendChatComment(current: string, comment: string): string {
  const head = current.replace(/\s+$/, "");
  return head.length > 0 ? `${head}\n\n${comment}\n` : `${comment}\n`;
}
