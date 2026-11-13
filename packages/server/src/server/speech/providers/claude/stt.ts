// CUSTOM(claude-stt): speech-to-text through Claude Code's voice service.
//
// Protocol (read from claude-cli 2.1.x, endpoint `/api/ws/speech_to_text/voice_stream`):
// - Connect with the Claude.ai OAuth token as a Bearer, the audio format in the query string
//   and optional `x-config-keyterms` (comma-separated words to favor).
// - Send binary PCM16 mono 16 kHz frames, `{"type":"KeepAlive"}` every 8 s, and
//   `{"type":"CloseStream"}` to flush the last words.
// - Receive `TranscriptInterim` / `TranscriptText` ({ data }: the current utterance so far),
//   `TranscriptEndpoint` (that utterance is done), `TranscriptError` and `error`.
//
// One Paseo segment (audio between two `commit()`s) maps to one WebSocket. The server splits
// a segment into utterances on its own, so a segment's text is its finished utterances plus
// the one in progress. `commit()` sends CloseStream and the segment's final text arrives when
// the server answers with an endpoint or closes; the next audio opens a new socket.
import { EventEmitter } from "node:events";
import type pino from "pino";
import { v4 } from "uuid";
import { WebSocket } from "ws";

import type {
  SpeechToTextProvider,
  StreamingTranscriptionEvent,
  StreamingTranscriptionSession,
} from "../../speech-provider.js";
import { getClaudeAccessToken } from "./credentials.js";

const VOICE_STREAM_URL = "wss://api.anthropic.com/api/ws/speech_to_text/voice_stream";
const SAMPLE_RATE = 16000;
const KEEP_ALIVE = '{"type":"KeepAlive"}';
const CLOSE_STREAM = '{"type":"CloseStream"}';
const KEEP_ALIVE_INTERVAL_MS = 8000;
// After CloseStream: give up waiting for the server's last words after this long...
const FINALIZE_SAFETY_MS = 5000;
// ...or sooner, when it sends nothing at all (nothing left to transcribe).
const FINALIZE_NO_DATA_MS = 1500;
const HANDSHAKE_TIMEOUT_MS = 10_000;
// Audio buffered while the socket connects; older audio is dropped past this (~60 s).
const MAX_PENDING_BYTES = SAMPLE_RATE * 2 * 60;
const MAX_KEYTERMS_LENGTH = 1024;
const USER_AGENT = "claude-cli/2.1.322 (external, cli)";

export interface ClaudeSttOptions {
  configDir: string;
  language: string;
  keyterms: string[];
  // Tests point these at a local server and a fixed token.
  url?: string;
  getAccessToken?: (logger: pino.Logger) => Promise<string>;
}

// Same cleanup Claude Code applies before sending keyterms in a header.
export function formatKeytermsHeader(terms: readonly string[]): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  let length = 0;
  for (const term of terms) {
    const clean = term
      .replace(/,/g, " ")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean || seen.has(clean)) continue;
    const added = clean.length + (kept.length > 0 ? 1 : 0);
    if (length + added > MAX_KEYTERMS_LENGTH) break;
    seen.add(clean);
    kept.push(clean);
    length += added;
  }
  return kept.join(",");
}

function joinText(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

interface VoiceStreamParams {
  url: string;
  getAccessToken: () => Promise<string>;
  keyterms: string;
  logger: pino.Logger;
  onText: (text: string) => void;
  onError: (error: Error) => void;
  // The server closed the socket cleanly without being asked (e.g. a time limit).
  onUnexpectedClose: () => void;
}

class VoiceStream {
  private ws: WebSocket | null = null;
  private open = false;
  private everOpened = false;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private sentAudio = false;
  private finals: string[] = [];
  private interim = "";
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private finalizing = false;
  private closeStreamSent = false;
  private finalizePromise: Promise<string> | null = null;
  private resolveFinalize: ((text: string) => void) | null = null;
  private safetyTimer: ReturnType<typeof setTimeout> | null = null;
  private noDataTimer: ReturnType<typeof setTimeout> | null = null;
  private done = false;

  constructor(private readonly params: VoiceStreamParams) {
    void this.connect();
  }

  text(): string {
    return joinText([...this.finals, this.interim]);
  }

  send(chunk: Buffer): void {
    if (this.done || this.finalizing) return;
    if (this.open && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
      this.sentAudio = true;
      return;
    }
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    while (this.pendingBytes > MAX_PENDING_BYTES && this.pending.length > 1) {
      this.pendingBytes -= this.pending.shift()!.length;
    }
  }

  finalize(): Promise<string> {
    if (this.finalizePromise) return this.finalizePromise;
    this.finalizing = true;
    this.finalizePromise = new Promise<string>((resolve) => {
      this.resolveFinalize = resolve;
    });
    if (this.done) {
      this.finish("already_closed");
    } else if (!this.sentAudio && this.pending.length === 0) {
      this.finish("no_audio");
    } else if (this.open) {
      this.sendCloseStream();
    }
    // Still connecting: `handleOpen` flushes the audio and then sends CloseStream.
    return this.finalizePromise;
  }

  abort(): void {
    this.finish("aborted");
  }

  private async connect(): Promise<void> {
    let token: string;
    try {
      token = await this.params.getAccessToken();
    } catch (error) {
      this.fail(toError(error));
      return;
    }
    if (this.done) return;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "x-app": "cli",
      "anthropic-client-platform": "cli",
    };
    if (this.params.keyterms) headers["x-config-keyterms"] = this.params.keyterms;

    const ws = new WebSocket(this.params.url, { headers, handshakeTimeout: HANDSHAKE_TIMEOUT_MS });
    this.ws = ws;
    ws.on("open", () => this.handleOpen(ws));
    ws.on("message", (data, isBinary) => {
      if (!isBinary) this.handleMessage(data.toString());
    });
    ws.on("unexpected-response", (request, response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      request.destroy();
      this.fail(
        new Error(
          status === 401 || status === 403
            ? `Claude speech-to-text refused the login (HTTP ${status}). Run \`claude\` and /login again.`
            : `Claude speech-to-text rejected the connection (HTTP ${status}).`,
        ),
      );
    });
    ws.on("error", (error) => this.fail(new Error(`Claude speech-to-text: ${error.message}`)));
    ws.on("close", (code, reason) => this.handleClose(code, reason.toString()));
  }

  private handleOpen(ws: WebSocket): void {
    if (this.done) {
      ws.close();
      return;
    }
    this.open = true;
    this.everOpened = true;
    ws.send(KEEP_ALIVE);
    for (const chunk of this.pending) ws.send(chunk);
    this.sentAudio ||= this.pending.length > 0;
    this.pending = [];
    this.pendingBytes = 0;
    this.keepAliveTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(KEEP_ALIVE);
    }, KEEP_ALIVE_INTERVAL_MS);
    if (this.finalizing) this.sendCloseStream();
  }

  private sendCloseStream(): void {
    if (this.closeStreamSent || this.ws?.readyState !== WebSocket.OPEN) return;
    this.closeStreamSent = true;
    this.ws.send(CLOSE_STREAM);
    this.safetyTimer = setTimeout(() => this.finish("safety_timeout"), FINALIZE_SAFETY_MS);
    this.noDataTimer = setTimeout(() => this.finish("no_data_timeout"), FINALIZE_NO_DATA_MS);
  }

  private handleMessage(raw: string): void {
    if (this.done) return;
    let message: {
      type?: string;
      data?: unknown;
      description?: string;
      error_code?: string;
      message?: string;
    };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    switch (message.type) {
      case "TranscriptInterim":
      case "TranscriptText": {
        if (this.noDataTimer) {
          clearTimeout(this.noDataTimer);
          this.noDataTimer = null;
        }
        if (typeof message.data === "string" && message.data) {
          this.interim = message.data;
          this.params.onText(this.text());
        }
        return;
      }
      case "TranscriptEndpoint": {
        if (this.interim) {
          this.finals.push(this.interim);
          this.interim = "";
        }
        if (this.closeStreamSent) this.finish("endpoint");
        return;
      }
      case "TranscriptError":
      case "error": {
        const detail =
          message.description ?? message.error_code ?? message.message ?? "unknown error";
        this.fail(new Error(`Claude speech-to-text: ${detail}`));
        return;
      }
      default:
        return;
    }
  }

  private handleClose(code: number, reason: string): void {
    this.open = false;
    if (this.done) return;
    if (this.finalizing) {
      this.finish("closed");
      return;
    }
    this.finish("closed");
    if (code === 1000 || code === 1005) {
      this.params.onUnexpectedClose();
    } else {
      this.params.onError(
        new Error(
          `Claude speech-to-text closed the connection (code ${code}${reason ? `: ${reason}` : ""}).`,
        ),
      );
    }
  }

  // While finalizing, an error ends the segment with the words heard so far. A socket that
  // never connected still reports it, or a short dictation would end empty without a reason.
  private fail(error: Error): void {
    if (this.done) return;
    this.params.logger.warn(
      { err: error, finalizing: this.finalizing },
      "Claude STT stream failed",
    );
    const report = !this.finalizing || !this.everOpened;
    this.finish("error");
    if (report) this.params.onError(error);
  }

  private finish(reason: string): void {
    if (!this.done) {
      this.done = true;
      this.params.logger.debug({ reason, chars: this.text().length }, "Claude STT stream finished");
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
      this.pending = [];
      this.pendingBytes = 0;
      const ws = this.ws;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        if (ws.readyState === WebSocket.OPEN) ws.close(1000);
        else ws.terminate();
      }
    }
    if (this.safetyTimer) clearTimeout(this.safetyTimer);
    if (this.noDataTimer) clearTimeout(this.noDataTimer);
    this.safetyTimer = null;
    this.noDataTimer = null;
    if (this.interim) {
      this.finals.push(this.interim);
      this.interim = "";
    }
    const resolve = this.resolveFinalize;
    this.resolveFinalize = null;
    resolve?.(this.text());
  }
}

interface Segment {
  id: string;
  // Text of earlier sockets of this segment that the server closed on its own.
  carried: string[];
}

export class ClaudeSTT implements SpeechToTextProvider {
  public readonly id = "claude" as const;
  private readonly logger: pino.Logger;

  constructor(
    private readonly options: ClaudeSttOptions,
    parentLogger: pino.Logger,
  ) {
    this.logger = parentLogger.child({ module: "agent", provider: "claude", component: "stt" });
    this.logger.info(
      {
        configDir: options.configDir,
        language: options.language,
        keyterms: options.keyterms.length,
      },
      "STT (Claude voice) initialized",
    );
  }

  public createSession(params: { logger: pino.Logger }): StreamingTranscriptionSession {
    const emitter = new EventEmitter();
    const logger = params.logger.child({ provider: "claude", component: "stt-session" });
    const { language, configDir } = this.options;
    const getAccessToken = this.options.getAccessToken
      ? () => this.options.getAccessToken!(logger)
      : () => getClaudeAccessToken(configDir, logger);
    const query = new URLSearchParams({
      encoding: "linear16",
      sample_rate: String(SAMPLE_RATE),
      channels: "1",
      endpointing_ms: "300",
      utterance_end_ms: "1000",
      language,
      use_conversation_engine: "true",
      forward_interims: "typed",
    });
    const url = `${this.options.url ?? VOICE_STREAM_URL}?${query.toString()}`;
    const keyterms = formatKeytermsHeader(this.options.keyterms);

    let closed = false;
    let segment: Segment = { id: v4(), carried: [] };
    let previousSegmentId: string | null = null;
    let active: VoiceStream | null = null;
    const finalizing = new Set<VoiceStream>();

    const emitTranscript = (event: StreamingTranscriptionEvent): void => {
      if (!closed) emitter.emit("transcript", event);
    };

    const openStream = (owner: Segment): VoiceStream => {
      const stream: VoiceStream = new VoiceStream({
        url,
        getAccessToken,
        keyterms,
        logger,
        onText: (text) => {
          emitTranscript({
            segmentId: owner.id,
            transcript: joinText([...owner.carried, text]),
            isFinal: false,
            language,
          });
        },
        onError: (error) => {
          if (stream === active) active = null;
          if (!closed) emitter.emit("error", error);
        },
        onUnexpectedClose: () => {
          if (stream !== active) return;
          owner.carried.push(stream.text());
          active = null;
        },
      });
      return stream;
    };

    return {
      requiredSampleRate: SAMPLE_RATE,
      async connect() {
        // Fails fast, before any audio, when there is no usable login.
        await getAccessToken();
      },
      appendPcm16(chunk: Buffer) {
        if (closed || chunk.length === 0) return;
        active ??= openStream(segment);
        active.send(chunk);
      },
      commit() {
        if (closed) return;
        const committed = segment;
        segment = { id: v4(), carried: [] };
        emitter.emit("committed", { segmentId: committed.id, previousSegmentId });
        previousSegmentId = committed.id;

        const stream = active;
        active = null;
        const emitFinal = (text: string) => {
          emitTranscript({
            segmentId: committed.id,
            transcript: joinText([...committed.carried, text]),
            isFinal: true,
            language,
          });
        };
        if (!stream) {
          queueMicrotask(() => emitFinal(""));
          return;
        }
        finalizing.add(stream);
        void (async () => {
          const text = await stream.finalize();
          finalizing.delete(stream);
          emitFinal(text);
        })();
      },
      clear() {
        active?.abort();
        active = null;
        segment = { id: v4(), carried: [] };
      },
      close() {
        closed = true;
        active?.abort();
        active = null;
        for (const stream of finalizing) stream.abort();
        finalizing.clear();
      },
      on(event: string, handler: (...args: never[]) => void) {
        emitter.on(event, handler as (...args: unknown[]) => void);
        return undefined;
      },
    };
  }
}
