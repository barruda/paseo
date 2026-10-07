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
  }),
  output: z.object({ id: z.string() }),
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
