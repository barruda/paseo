// CUSTOM(chat-code-run): decides which markdown code blocks get a Run button and what
// command the button sends to the shell-command plugin (`!<command>`).

const SHELL_LANGUAGES = new Set(["bash", "sh", "shell", "zsh", "console", "shellsession"]);

// Unlabeled blocks are often output, file contents, or prose; only offer Run when the block
// is one line. Labeled shell blocks can be short scripts.
const MAX_UNLABELED_LINES = 1;
const MAX_SHELL_LINES = 12;

// `$ cmd` (shell prompt) and `!cmd` / `! cmd` (Paseo / Claude Code shell shorthand).
// `$` needs a following space so `$HOME/bin/tool` is not stripped.
const PROMPT_MARKER = /^\s*(?:\$\s+|!\s*)(?=\S)/;

export function resolveRunnableCommand(
  code: string,
  language: string | null | undefined,
): string | null {
  const normalizedLanguage = language?.trim().toLowerCase() || null;
  if (normalizedLanguage && !SHELL_LANGUAGES.has(normalizedLanguage)) return null;

  const lines = code
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return null;

  // In a transcript (`$ cmd` followed by its output), only the prompted lines are commands.
  const prompted = lines.filter((line) => PROMPT_MARKER.test(line));
  const commandLines = (prompted.length > 0 ? prompted : lines).map((line) =>
    line.replace(PROMPT_MARKER, "").trimEnd(),
  );

  const maxLines = normalizedLanguage ? MAX_SHELL_LINES : MAX_UNLABELED_LINES;
  if (commandLines.length > maxLines) return null;

  const command = commandLines.join("\n").trim();
  return command.length > 0 ? command : null;
}
