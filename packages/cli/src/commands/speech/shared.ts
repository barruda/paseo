// CUSTOM(cli-dictation): pieces shared by `paseo speech dictate` and `paseo speech wake`.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { getErrorMessage } from "../../utils/errors.js";

// connectToDaemon throws CLI CommandError objects, not Error instances.
export function describeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const { message, details } = error as { message: unknown; details?: unknown };
    return details ? `${String(message)} (${String(details)})` : String(message);
  }
  return getErrorMessage(error);
}

// Same format the app's dictation sends: 16 kHz mono signed 16-bit little-endian PCM.
export const PCM_DICTATION_FORMAT = "audio/pcm;rate=16000;bits=16";
const SEGMENT_BYTES = 3200; // 100 ms
const ACK_TIMEOUT_MS = 30_000;
const RECORDER_ARGS = ["--raw", "--rate", "16000", "--channels", "1", "--format", "s16", "-"];

/** Cuts a PCM byte stream into fixed 100 ms base64 segments, never splitting a sample. */
export class PcmSegmenter {
  private pending = Buffer.alloc(0);

  push(data: Buffer): string[] {
    this.pending = Buffer.concat([this.pending, data]);
    const segments: string[] = [];
    while (this.pending.length >= SEGMENT_BYTES) {
      segments.push(this.pending.subarray(0, SEGMENT_BYTES).toString("base64"));
      this.pending = this.pending.subarray(SEGMENT_BYTES);
    }
    return segments;
  }

  flush(): string | null {
    const usable = this.pending.subarray(0, this.pending.length - (this.pending.length % 2));
    this.pending = Buffer.alloc(0);
    return usable.length > 0 ? usable.toString("base64") : null;
  }
}

export type DictationStreamClient = Pick<
  DaemonClient,
  | "startDictationStream"
  | "sendDictationStreamChunk"
  | "finishDictationStream"
  | "cancelDictationStream"
  | "subscribeRawMessages"
>;

/**
 * Streams segments to the daemon as they are recorded. Segments recorded before the daemon
 * acknowledges the stream are buffered and sent once it does.
 */
export class DictationUpload {
  private readonly segments: string[] = [];
  private sent = 0;
  private acked = -1;
  private ready = false;
  private readonly started: Promise<void>;
  private readonly ackWaiters = new Set<() => void>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly client: DictationStreamClient,
    private readonly dictationId: string = randomUUID(),
  ) {
    this.unsubscribe = client.subscribeRawMessages((message) => {
      if (message.type !== "dictation_stream_ack") return;
      if (message.payload.dictationId !== this.dictationId) return;
      this.acked = Math.max(this.acked, message.payload.ackSeq);
      for (const waiter of this.ackWaiters) waiter();
    });
    this.started = this.start();
    // finish() reports a failed start; this only keeps it from being unhandled meanwhile.
    this.started.catch(() => undefined);
  }

  private async start(): Promise<void> {
    await this.client.startDictationStream(this.dictationId, PCM_DICTATION_FORMAT);
    this.ready = true;
    this.flush();
  }

  push(segment: string): void {
    this.segments.push(segment);
    this.flush();
  }

  async finish(): Promise<string> {
    try {
      await this.started;
      const finalSeq = this.segments.length - 1;
      if (finalSeq < 0) {
        this.client.cancelDictationStream(this.dictationId);
        return "";
      }
      this.flush();
      await this.waitForAck(finalSeq);
      const result = await this.client.finishDictationStream(this.dictationId, finalSeq);
      return result.text.trim();
    } finally {
      this.unsubscribe();
    }
  }

  private flush(): void {
    if (!this.ready) return;
    while (this.sent < this.segments.length) {
      const seq = this.sent;
      this.client.sendDictationStreamChunk(
        this.dictationId,
        seq,
        this.segments[seq],
        PCM_DICTATION_FORMAT,
      );
      this.sent = seq + 1;
    }
  }

  private waitForAck(seq: number): Promise<void> {
    if (this.acked >= seq) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ackWaiters.delete(check);
        reject(new Error("Timed out waiting for the daemon to receive the audio"));
      }, ACK_TIMEOUT_MS);
      const check = () => {
        if (this.acked < seq) return;
        clearTimeout(timer);
        this.ackWaiters.delete(check);
        resolve();
      };
      this.ackWaiters.add(check);
    });
  }
}

/** Where a running `paseo speech <command>` records its pid, for --toggle. */
export function speechPidFile(command: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.XDG_RUNTIME_DIR || os.tmpdir(), `paseo-${command}.pid`);
}

/** The pid of a speech command still running, or null. Clears a stale pid file. */
export function readRunningPid(pidFile: string): number | null {
  let pid: number;
  try {
    pid = Number.parseInt(fs.readFileSync(pidFile, "utf8"), 10);
  } catch {
    return null;
  }
  if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      // Not running; fall through and clear the file.
    }
  }
  fs.rmSync(pidFile, { force: true });
  return null;
}

export function runQuietly(command: string, args: string[], input?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [input === undefined ? "ignore" : "pipe", "ignore", "ignore"],
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
    child.stdin?.end(input);
  });
}

export function createNotifier(enabled: boolean | undefined) {
  return (summary: string, body = "", timeoutMs = 3000) => {
    if (!enabled) return;
    void runQuietly("notify-send", ["-a", "Paseo", "-t", String(timeoutMs), summary, body]).catch(
      () => undefined,
    );
  };
}

/** Records the default mic as 16 kHz mono PCM on stdout. */
export function spawnRecorder() {
  return spawn("pw-record", RECORDER_ARGS, { stdio: ["ignore", "pipe", "pipe"] });
}
