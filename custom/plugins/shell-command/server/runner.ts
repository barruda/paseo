import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  SHELL_COMMAND_TIMELINE_KIND,
  SHELL_COMMAND_TIMELINE_VERSION,
  type ShellCommandTimelineData,
  type runShellCommandRpc,
  type sendShellInputRpc,
  type stopShellCommandRpc,
} from "../shared/shell-command";
import { cleanOutput, keepTail, MAX_OUTPUT_BYTES } from "./output";

const FLUSH_INTERVAL_MS = 300;
const STOP_GRACE_MS = 3000;
const MAX_RUNTIME_MS = 30 * 60 * 1000;
const TERMINAL_COLUMNS = 160;
const TERMINAL_ROWS = 40;
const CTRL_C = "\x03";
const CTRL_D = "\x04";

// util-linux `script` gives the command a pseudo-terminal without a native dependency, so
// prompts (read, sudo, ssh, y/n questions) behave as they do in a terminal. Other platforms'
// `script` takes different flags; they fall back to plain pipes.
const SCRIPT_PATH =
  process.platform === "linux"
    ? (["/usr/bin/script", "/bin/script"].find((candidate) => existsSync(candidate)) ?? null)
    : null;

interface RunningCommand {
  child: ChildProcess;
  stopRequested: boolean;
  stop(): void;
  write(text: string): boolean;
}

type Paseo = PluginHandlerContext["paseo"];

export class ShellCommandRunner {
  private readonly running = new Map<string, RunningCommand>();

  run(input: RpcInput<typeof runShellCommandRpc>, { paseo }: PluginHandlerContext): { id: string } {
    const id = `sh-${randomUUID()}`;
    const startedAt = new Date();
    const data: ShellCommandTimelineData = {
      id,
      command: input.command,
      cwd: input.cwd,
      status: "running",
      exitCode: null,
      signal: null,
      output: "",
      interactive: SCRIPT_PATH !== null,
      truncated: false,
      startedAt: startedAt.toISOString(),
      durationMs: null,
      error: null,
    };
    const publisher = createPublisher(paseo, input.agentId, id);

    if (!existsSync(input.cwd)) {
      publisher.publish({ ...data, status: "failed", error: `Directory not found: ${input.cwd}` });
      return { id };
    }

    // Raw output is kept bounded too: twice the visible budget leaves room for carriage-return
    // rewrites that cleanOutput collapses.
    let raw = "";
    let rawTruncated = false;
    const snapshot = (): ShellCommandTimelineData => {
      const { text, truncated } = keepTail(cleanOutput(raw));
      return { ...data, output: text, truncated: truncated || rawTruncated };
    };

    const shell = process.env.SHELL || "/bin/sh";
    const [file, args] = SCRIPT_PATH
      ? [
          SCRIPT_PATH,
          [
            "-qefc",
            `stty cols ${TERMINAL_COLUMNS} rows ${TERMINAL_ROWS} 2>/dev/null; exec ${shellQuote(shell)} -lc ${shellQuote(input.command)}`,
            "/dev/null",
          ],
        ]
      : [shell, ["-lc", input.command]];
    const child = spawn(file, args, {
      cwd: input.cwd,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        TERM: "dumb",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        PAGER: "cat",
        GIT_PAGER: "cat",
        GIT_TERMINAL_PROMPT: "0",
      },
    });

    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        publisher.publish(snapshot());
      }, FLUSH_INTERVAL_MS);
    };
    const onChunk = (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      if (raw.length > MAX_OUTPUT_BYTES * 2) {
        raw = raw.slice(-MAX_OUTPUT_BYTES * 2);
        rawTruncated = true;
      }
      scheduleFlush();
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    // Writing after the command exits raises EPIPE; the close handler reports the exit.
    child.stdin?.on("error", () => {});

    const entry: RunningCommand = {
      child,
      stopRequested: false,
      stop: () => {
        entry.stopRequested = true;
        killGroup(child, "SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) killGroup(child, "SIGKILL");
        }, STOP_GRACE_MS).unref();
      },
      write: (text) => {
        const stdin = child.stdin;
        if (!stdin || stdin.destroyed || stdin.writableEnded) return false;
        if (!SCRIPT_PATH) {
          // Without a terminal there's no line discipline to turn these into a signal and EOF.
          if (text === CTRL_C) {
            killGroup(child, "SIGINT");
            return true;
          }
          if (text === CTRL_D) {
            stdin.end();
            return true;
          }
        }
        stdin.write(text);
        return true;
      },
    };
    this.running.set(id, entry);
    const runtimeLimit = setTimeout(entry.stop, MAX_RUNTIME_MS);
    runtimeLimit.unref();

    let finished = false;
    const finish = (patch: Partial<ShellCommandTimelineData>) => {
      if (finished) return;
      finished = true;
      clearTimeout(runtimeLimit);
      if (flushTimer) clearTimeout(flushTimer);
      this.running.delete(id);
      Object.assign(data, patch, { durationMs: Date.now() - startedAt.getTime() });
      publisher.publish(snapshot());
    };
    child.on("error", (error) => finish({ status: "failed", error: error.message }));
    child.on("close", (code, signal) => {
      let status: ShellCommandTimelineData["status"] = code === 0 ? "completed" : "failed";
      if (entry.stopRequested) status = "stopped";
      finish({ status, exitCode: code, signal });
    });

    publisher.publish(snapshot());
    return { id };
  }

  input(input: RpcInput<typeof sendShellInputRpc>): { accepted: boolean } {
    const entry = this.running.get(input.id);
    return { accepted: entry ? entry.write(input.text) : false };
  }

  stop(input: RpcInput<typeof stopShellCommandRpc>): { stopped: boolean } {
    const entry = this.running.get(input.id);
    if (!entry) return { stopped: false };
    entry.stop();
    return { stopped: true };
  }

  stopAll(): void {
    for (const entry of this.running.values()) entry.stop();
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    // detached: true makes the shell a process group leader, so this also reaches the
    // commands it started (pipelines, dev servers, test workers).
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

/** Serializes appends so a slow earlier write never lands after a newer snapshot. */
function createPublisher(paseo: Paseo, agentId: string, id: string) {
  let queue: Promise<unknown> = Promise.resolve();
  const timeline = paseo.agents.ref(agentId).timeline;
  return {
    publish(data: ShellCommandTimelineData) {
      queue = queue
        .then(() =>
          timeline.append({
            type: "plugin",
            id,
            kind: SHELL_COMMAND_TIMELINE_KIND,
            version: SHELL_COMMAND_TIMELINE_VERSION,
            data,
          }),
        )
        .catch((error: unknown) => {
          console.error(`[shell-command] failed to append timeline row ${id}`, error);
        });
    },
  };
}
