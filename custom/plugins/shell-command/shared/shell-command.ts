import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const SHELL_COMMAND_TIMELINE_KIND = "shell-command";
export const SHELL_COMMAND_TIMELINE_VERSION = 1;

export const shellCommandStatusSchema = z.enum(["running", "completed", "failed", "stopped"]);

export const shellCommandTimelineSchema = z.object({
  /** The timeline row id; the renderer needs it to stop the command. */
  id: z.string(),
  command: z.string(),
  cwd: z.string(),
  /** Lets Run again file the command under the same project history. Older rows lack it. */
  workspaceId: z.string().optional(),
  status: shellCommandStatusSchema,
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  output: z.string(),
  /**
   * True when the command runs in a pseudo-terminal: typed input is echoed and prompts that need a
   * terminal work. Rows recorded before input existed lack the field.
   */
  interactive: z.boolean().optional(),
  /** True when the head of the output was dropped to fit the timeline row size limit. */
  truncated: z.boolean(),
  startedAt: z.string(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
});

export type ShellCommandTimelineData = z.output<typeof shellCommandTimelineSchema>;

export const runShellCommandRpc = defineRpc({
  name: "run",
  input: z.object({
    agentId: z.string().min(1),
    cwd: z.string().min(1),
    command: z.string().min(1),
    /** Files the command under its workspace's project history. Without it, under `cwd`. */
    workspaceId: z.string().min(1).optional(),
  }),
  output: z.object({ id: z.string() }),
});

/** Commands run in the workspace's project (or `cwd` without a workspace), newest first. */
export const shellHistoryRpc = defineRpc({
  name: "history",
  input: z.object({
    cwd: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
  }),
  output: z.object({ commands: z.array(z.string()) }),
});

/**
 * Files and folders whose path starts with `word`, resolved against `cwd` like a shell would
 * (`~/`, absolute, relative). Each `value` replaces `word` as typed: shell-escaped, with a
 * trailing `/` on folders.
 */
export const completePathRpc = defineRpc({
  name: "complete-path",
  input: z.object({ cwd: z.string().min(1), word: z.string() }),
  output: z.object({
    entries: z.array(z.object({ value: z.string(), kind: z.enum(["file", "directory"]) })),
  }),
});

export const stopShellCommandRpc = defineRpc({
  name: "stop",
  input: z.object({ id: z.string().min(1) }),
  output: z.object({ stopped: z.boolean() }),
});

/** Writes to a running command's input. Send "\x03" for Ctrl-C and "\x04" for Ctrl-D. */
export const sendShellInputRpc = defineRpc({
  name: "input",
  input: z.object({ id: z.string().min(1), text: z.string().min(1) }),
  output: z.object({ accepted: z.boolean() }),
});
