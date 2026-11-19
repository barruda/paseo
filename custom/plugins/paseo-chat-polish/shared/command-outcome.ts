import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

// CUSTOM(command-outcome): one place decides whether a shell command that ended with a nonzero exit
// code really failed (red) or only exited nonzero (neutral, with the code). The recap, the command row
// and the merged steps row all ask it.

type ToolCall = Extract<AgentTimelineItem, { type: "tool_call" }>;

/**
 * - `ok`: exit 0, or no exit code to judge.
 * - `nonzero`: exited nonzero but looks harmless: a grep with no match, a `[ -n "$x" ] && …` at the end, a loop that hit a
 *   vanished /proc entry after printing what it found.
 * - `failed`: the harness reported an error of its own (timeout, denial, interruption), the process was killed, the command was not
 *   found, it printed nothing, or its output carries an error message.
 */
export type CommandOutcome =
  | { kind: "ok"; exit?: number; output: string }
  | { kind: "nonzero"; exit: number; output: string }
  | { kind: "failed"; exit?: number; output: string };

// Claude reports a failed Bash call as "Exit code N" followed by the combined output; some transcripts prefix "Error: ".
const EXIT_LINE = /^(?:Error: )?Exit code (\d+)[ \t]*\r?\n?/;

// Commands whose exit 1 answers a question ("no match", "false", "differs") instead of reporting a fault.
const QUESTION_COMMANDS = new Set(["grep", "egrep", "fgrep", "rg", "ag", "pgrep", "test", "[", "[[", "diff", "cmp", "false"]);

// Output that means something broke, whatever the exit code. A starting point, kept small on purpose: a pattern that also matches
// ordinary output (grep hits, logs) turns harmless commands red again.
const ERROR_PATTERNS: readonly RegExp[] = [
  /command not found/i,
  /permission denied/i,
  /Traceback \(most recent call last\)/,
  /^\s*(?:[\w.-]+: )?(?:error|fatal)(?:\[[^\]\n]*\])?:/im,
  /^\s*\w*(?:Error|Exception): /m,
  /\berror TS\d+:/,
  /^npm (?:ERR!|error) /m,
  /^\s*FAIL\s/m,
  /Segmentation fault|core dumped/,
];

/** The text of a provider error: `message`, tool-result `content` (string or text blocks), or a plain string. */
function errorText(error: unknown): string | undefined {
  if (error == null) return undefined;
  if (typeof error === "string") return error;
  const e = error as { message?: unknown; content?: unknown };
  if (typeof e.message === "string") return e.message;
  if (typeof e.content === "string") return e.content;
  if (Array.isArray(e.content))
    return e.content.map((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : "")).join("\n");
  return undefined;
}

/** The commands of the last statement, `[ -n "$f" ] && grep x "$f" | head` → ["[", "grep", "head"]. Quoted text is skipped. */
export function lastStatementCommands(command: string): string[] {
  const bare = command
    .replace(/\\\n/g, " ")
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/#[^\n]*/g, "");
  const statements = bare.split(/;|\n|(?<![|&>])&(?![&>])/).map((s) => s.trim()).filter((s) => s && !/^(?:done|fi|esac|\})$/.test(s));
  const last = statements.at(-1) ?? "";
  return last
    .split(/&&|\|\||\|/)
    .map((stage) => {
      const words = stage.trim().replace(/^[!({\s]+/, "").split(/\s+/);
      // Skip env assignments and wrappers that run the real command.
      while (words.length > 1 && (/^\w+=/.test(words[0]!) || ["sudo", "command", "exec", "time", "nice", "then", "do", "else"].includes(words[0]!))) words.shift();
      return (words[0] ?? "").replace(/^.*\//, "");
    })
    .filter(Boolean);
}

/** Whether a shell command really failed, only exited nonzero, or succeeded. Undefined for anything but a settled shell call. */
export function commandOutcome(item: ToolCall): CommandOutcome | undefined {
  if (item.detail.type !== "shell" || item.status === "running" || item.status === "canceled") return undefined;
  const detail = item.detail;
  const error = item.status === "failed" ? (errorText(item.error) ?? "").trim() : "";
  const exitLine = EXIT_LINE.exec(error);
  const output = (detail.output ?? (exitLine ? error.slice(exitLine[0].length) : error)).trim();
  const exit = typeof detail.exitCode === "number" ? detail.exitCode : exitLine ? Number(exitLine[1]) : undefined;

  if (item.status === "completed" && !exit) return { kind: "ok", exit, output };
  // Failed without an exit code: the harness's own error (timeout, permission denial, sandbox, interruption) or a killed process.
  if (exit === undefined || exit === 0) return { kind: "failed", exit, output };
  // 124 timeout(1), 126 not executable, 127 not found, 128+N killed by signal N.
  if (exit >= 124) return { kind: "failed", exit, output };
  if (ERROR_PATTERNS.some((pattern) => pattern.test(output))) return { kind: "failed", exit, output };
  if (exit === 1 && output) return { kind: "nonzero", exit, output };
  if (exit === 1 && lastStatementCommands(detail.command).some((name) => QUESTION_COMMANDS.has(name))) return { kind: "nonzero", exit, output };
  return { kind: "failed", exit, output };
}

/** A tool call that failed for real: any failed non-shell call, and a shell call the heuristic above calls failed. */
export function isRealFailure(item: AgentTimelineItem): boolean {
  if (item.type !== "tool_call") return false;
  const outcome = commandOutcome(item);
  return outcome ? outcome.kind === "failed" : item.status === "failed";
}

/** The last lines of a command's output, short enough for a recap row. */
export function outputTail(output: string, lines = 3, chars = 300): string | undefined {
  const tail = output.replace(/\s+$/, "").split("\n").filter((line) => line.trim()).slice(-lines).join("\n");
  if (!tail) return undefined;
  return tail.length > chars ? "…" + tail.slice(-chars) : tail;
}
