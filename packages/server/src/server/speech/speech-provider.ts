import type pino from "pino";
import type { Readable } from "node:stream";

export interface LogprobToken {
  token: string;
  logprob: number;
  bytes?: number[];
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  logprobs?: LogprobToken[];
  avgLogprob?: number;
  isLowConfidence?: boolean;
}

export interface StreamingTranscriptionCommittedEvent {
  segmentId: string;
  previousSegmentId: string | null;
}

export interface StreamingTranscriptionEvent {
  segmentId: string;
  transcript: string;
  isFinal: boolean;
  language?: string;
  logprobs?: LogprobToken[];
  avgLogprob?: number;
  isLowConfidence?: boolean;
}

export interface StreamingTranscriptionSession {
  /**
   * Required PCM16LE sample rate for `appendPcm16()`.
   * Callers are responsible for resampling before appending.
   */
  requiredSampleRate: number;

  connect(): Promise<void>;
  appendPcm16(pcm16le: Buffer): void;
  commit(): void;
  clear(): void;
  close(): void;

  on(event: "committed", handler: (payload: StreamingTranscriptionCommittedEvent) => void): unknown;
  on(event: "transcript", handler: (payload: StreamingTranscriptionEvent) => void): unknown;
  on(event: "error", handler: (err: unknown) => void): unknown;
}

export interface SpeechToTextProvider {
  id: "openai" | "local" | (string & {});
  createSession(params: {
    logger: pino.Logger;
    language?: string;
    prompt?: string;
    // CUSTOM(dictation-tuning): minimum time between re-transcriptions of the open segment,
    // for providers that send partial text by re-transcribing it.
    decodeIntervalMs?: number;
  }): StreamingTranscriptionSession;
}

export interface SpeechStreamResult {
  stream: Readable;
  format: string;
}

export interface TextToSpeechProvider {
  // CUSTOM(claude-tts-whole-text): the provider takes the whole reply in one request and
  // streams PCM16 audio, so the TTS manager must not split the text into segments.
  streamsWholeText?: boolean;
  synthesizeSpeech(text: string): Promise<SpeechStreamResult>;
}
