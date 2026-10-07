// Timeline rows are capped at 64 KiB of serialized data; leave room for the other fields.
export const MAX_OUTPUT_BYTES = 48 * 1024;

// eslint-disable-next-line no-control-regex -- ANSI escape sequences start with ESC (0x1b).
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex -- bells, backspaces and the like from a terminal.
const CONTROL_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * Renders raw process output the way a terminal would leave it on screen, minus styling:
 * escape sequences are dropped and a carriage return overwrites the line, so progress bars
 * collapse to their final state instead of filling the card.
 */
export function cleanOutput(raw: string): string {
  return raw
    .replace(ANSI_PATTERN, "")
    .replace(/\r+\n/g, "\n")
    .split("\n")
    .map((line) => {
      const lastReturn = line.lastIndexOf("\r");
      return lastReturn === -1 ? line : line.slice(lastReturn + 1);
    })
    .join("\n")
    .replace(CONTROL_PATTERN, "");
}

/** Keeps the tail of the output, since the end of a command's output is what you look for. */
export function keepTail(
  text: string,
  maxBytes = MAX_OUTPUT_BYTES,
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
  let tail = text.slice(-maxBytes);
  while (Buffer.byteLength(tail, "utf8") > maxBytes) {
    tail = tail.slice(Math.ceil(tail.length / 10));
  }
  const firstNewline = tail.indexOf("\n");
  if (firstNewline !== -1 && firstNewline < tail.length - 1) tail = tail.slice(firstNewline + 1);
  return { text: tail, truncated: true };
}
