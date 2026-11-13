// CUSTOM(claude-tts): text-to-speech through the claude.ai read-aloud service.
//
// Protocol (undocumented; read from the Claude desktop app 45.2.1 bundle, search
// `text_to_speech/text_stream` in ion-dist.asar):
// - Connect to `wss://api.anthropic.com/api/ws/text_to_speech/text_stream` with the same
//   headers as the speech-to-text socket (Claude.ai OAuth token as a Bearer). Query:
//   `output_format=pcm_24000` (16-bit LE mono PCM at 24 kHz; `pcm_16000` and `opus_48000_32`
//   also exist), `voice` (buttery, airy, mellow, glassy or rounded), `tts_speed` (two
//   decimals, 0.7 to 1.5), `client_platform=cli` and an optional `language` (`pt`, `pt-BR`, `en`).
// - Send JSON text frames: `{"type":"text_chunk","text":"..."}` once or more, then
//   `{"type":"close_stream"}`. While waiting, `{"type":"keep_alive"}` every 4 s. The web client
//   splits text over 800 characters at sentence boundaries; so does `splitTtsText`.
// - Receive binary frames of raw PCM, then `{"type":"SpeechComplete","audio_sent_ms":N}` and a
//   1000 close. Failures come as `{"type":"SpeechError","error_code":...}` or
//   `{"type":"error",...}`, or as an HTTP error on the handshake (401, 403, 429).
// Measured: socket open about 600 ms, first audio about 800 ms.
import { Readable } from "node:stream";
import type pino from "pino";
import { WebSocket } from "ws";

import type { SpeechStreamResult, TextToSpeechProvider } from "../../speech-provider.js";
import { getClaudeAccessToken } from "./credentials.js";

const TEXT_STREAM_URL = "wss://api.anthropic.com/api/ws/text_to_speech/text_stream";
const OUTPUT_FORMAT = "pcm_24000";
export const CLAUDE_TTS_SAMPLE_RATE = 24000;
const KEEP_ALIVE = '{"type":"keep_alive"}';
const CLOSE_STREAM = '{"type":"close_stream"}';
const KEEP_ALIVE_INTERVAL_MS = 4000;
const HANDSHAKE_TIMEOUT_MS = 8000;
// No frame at all for this long, before or between audio frames, ends the request.
const IDLE_TIMEOUT_MS = 20_000;
const MAX_CHUNK_CHARS = 800;
const USER_AGENT = "claude-cli/2.1.322 (external, cli)";

export const CLAUDE_TTS_VOICES = ["buttery", "airy", "mellow", "glassy", "rounded"] as const;
export type ClaudeTtsVoice = (typeof CLAUDE_TTS_VOICES)[number];
export const DEFAULT_CLAUDE_TTS_VOICE: ClaudeTtsVoice = "buttery";
export const MIN_CLAUDE_TTS_SPEED = 0.7;
export const MAX_CLAUDE_TTS_SPEED = 1.5;
export const DEFAULT_CLAUDE_TTS_SPEED = 1;

export function clampClaudeTtsSpeed(speed: number | undefined): number {
  if (speed === undefined || !Number.isFinite(speed)) return DEFAULT_CLAUDE_TTS_SPEED;
  return Math.min(MAX_CLAUDE_TTS_SPEED, Math.max(MIN_CLAUDE_TTS_SPEED, speed));
}

export function resolveClaudeTtsVoice(voice: string | undefined): string {
  const trimmed = voice?.trim().toLowerCase();
  return trimmed ? trimmed : DEFAULT_CLAUDE_TTS_VOICE;
}

// Sentence-aware split like the claude.ai web client: break at sentence ends and blank lines,
// then pack the pieces greedily up to the chunk limit. A single sentence longer than the limit
// stays whole.
export function splitTtsText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];
  const pieces = trimmed
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + 1 + piece.length > maxChars) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface ClaudeTtsOptions {
  configDir: string;
  language?: string;
  voice?: string;
  speed?: number;
  // Tests point these at a local server, a fixed token and short timeouts.
  url?: string;
  getAccessToken?: (logger: pino.Logger) => Promise<string>;
  handshakeTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface ClaudeTtsOverrides {
  voice?: string;
  speed?: number;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class ClaudeTTS implements TextToSpeechProvider {
  public readonly id = "claude" as const;
  private readonly logger: pino.Logger;

  constructor(
    private readonly options: ClaudeTtsOptions,
    parentLogger: pino.Logger,
  ) {
    this.logger = parentLogger.child({ module: "agent", provider: "claude", component: "tts" });
    this.logger.info(
      {
        configDir: options.configDir,
        language: options.language,
        voice: resolveClaudeTtsVoice(options.voice),
        speed: clampClaudeTtsSpeed(options.speed),
      },
      "TTS (Claude read-aloud) initialized",
    );
  }

  // Resolves with the stream when the first audio frame arrives; later frames are pushed as
  // they come and a failure after that errors the stream.
  public async synthesizeSpeech(
    text: string,
    overrides?: ClaudeTtsOverrides,
  ): Promise<SpeechStreamResult> {
    const chunks = splitTtsText(text);
    if (chunks.length === 0) {
      throw new Error("Claude text-to-speech needs some text to speak.");
    }
    const getAccessToken = this.options.getAccessToken
      ? () => this.options.getAccessToken!(this.logger)
      : () => getClaudeAccessToken(this.options.configDir, this.logger);
    const token = await getAccessToken();

    const query = new URLSearchParams({
      output_format: OUTPUT_FORMAT,
      voice: resolveClaudeTtsVoice(overrides?.voice ?? this.options.voice),
      tts_speed: clampClaudeTtsSpeed(overrides?.speed ?? this.options.speed).toFixed(2),
      client_platform: "cli",
    });
    const language = this.options.language?.trim();
    if (language) query.set("language", language);
    const url = `${this.options.url ?? TEXT_STREAM_URL}?${query.toString()}`;

    return new Promise<SpeechStreamResult>((resolve, reject) => {
      const stream = new Readable({
        read() {
          // Audio is pushed by the socket.
        },
      });
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": USER_AGENT,
          "x-app": "cli",
          "anthropic-client-platform": "cli",
        },
        handshakeTimeout: this.options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
      });
      let settled = false;
      let finished = false;
      let carry: Buffer | null = null;
      let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const idleMs = this.options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;

      const cleanup = () => {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        if (idleTimer) clearTimeout(idleTimer);
        keepAliveTimer = null;
        idleTimer = null;
      };
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        cleanup();
        this.logger.warn({ err: error, started: settled }, "Claude TTS failed");
        if (!settled) {
          settled = true;
          reject(error);
        } else {
          stream.destroy(error);
        }
        ws.terminate();
      };
      const complete = () => {
        if (finished) return;
        finished = true;
        cleanup();
        if (carry && carry.length > 0) carry = null;
        if (!settled) {
          settled = true;
          reject(new Error("Claude text-to-speech returned no audio."));
        } else {
          stream.push(null);
        }
        ws.close();
      };
      const armIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => fail(new Error("Claude text-to-speech timed out waiting for audio.")),
          idleMs,
        );
      };
      const pushAudio = (data: Buffer) => {
        // Keep every pushed chunk on a 16-bit sample boundary.
        const merged = carry ? Buffer.concat([carry, data]) : data;
        const usable = merged.length - (merged.length % 2);
        carry = usable < merged.length ? merged.subarray(usable) : null;
        if (usable === 0) return;
        stream.push(merged.subarray(0, usable));
        if (!settled) {
          settled = true;
          resolve({ stream, format: `pcm;rate=${CLAUDE_TTS_SAMPLE_RATE}` });
        }
      };

      stream.on("close", () => {
        if (!finished) {
          finished = true;
          cleanup();
          ws.terminate();
        }
      });

      ws.on("open", () => {
        armIdleTimer();
        for (const chunk of chunks) {
          ws.send(JSON.stringify({ type: "text_chunk", text: chunk }));
        }
        ws.send(CLOSE_STREAM);
        keepAliveTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(KEEP_ALIVE);
        }, KEEP_ALIVE_INTERVAL_MS);
      });
      ws.on("message", (data, isBinary) => {
        if (finished) return;
        armIdleTimer();
        if (isBinary) {
          pushAudio(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
          return;
        }
        let message: { type?: string; error_code?: string; message?: string; error?: unknown };
        try {
          message = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (message.type === "SpeechComplete") {
          complete();
        } else if (message.type === "SpeechError" || message.type === "error") {
          const detail =
            message.error_code ??
            message.message ??
            (typeof message.error === "string" ? message.error : "unknown error");
          fail(new Error(`Claude text-to-speech: ${detail}`));
        }
      });
      ws.on("unexpected-response", (request, response) => {
        const status = response.statusCode ?? 0;
        response.resume();
        request.destroy();
        fail(
          new Error(
            status === 401 || status === 403
              ? `Claude text-to-speech refused the login (HTTP ${status}). Run \`claude\` and /login again.`
              : `Claude text-to-speech rejected the connection (HTTP ${status}).`,
          ),
        );
      });
      ws.on("error", (error) =>
        fail(new Error(`Claude text-to-speech: ${toError(error).message}`)),
      );
      ws.on("close", (code, reason) => {
        if (finished) return;
        // A clean close without SpeechComplete still ends what was already spoken.
        if (code === 1000 || code === 1005) {
          complete();
        } else {
          const why = reason.toString();
          fail(
            new Error(
              `Claude text-to-speech closed the connection (code ${code}${why ? `: ${why}` : ""}).`,
            ),
          );
        }
      });
    });
  }
}
