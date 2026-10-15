// CUSTOM(wake-dictation): short utterances keep the proof of concept on the existing STT path.
export type WakeDictationPhase = "armed" | "capturing" | "processing";

const MIN_RMS = 0.008;
const END_SILENCE_MS = 900;
const MAX_UTTERANCE_MS = 12_000;
const WAKE_PHRASE = /\bwake[\s,.!?]+up\b[\s,.!?]*/i;
const DONE_SUFFIX = /(?:^|\s)done[.!?]*\s*$/i;

export interface WakeDictationDependencies {
  transcribe(chunks: string[]): Promise<string>;
  copy(text: string): Promise<void>;
  onPhase(phase: WakeDictationPhase): void;
  onCopied(text: string): void;
  onError(error: Error): void;
}

function pcmEnergy(base64: string): { rms: number; durationMs: number } {
  const binary = atob(base64);
  const samples = Math.floor(binary.length / 2);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const raw = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    const signed = raw >= 0x8000 ? raw - 0x10000 : raw;
    const normalized = signed / 32768;
    sum += normalized * normalized;
  }
  return {
    rms: samples ? Math.sqrt(sum / samples) : 0,
    durationMs: (samples / 16000) * 1000,
  };
}

export class WakeDictationController {
  private readonly deps: WakeDictationDependencies;
  private phase: WakeDictationPhase = "armed";
  private chunks: string[] = [];
  private queuedChunks: string[] = [];
  private utteranceMs = 0;
  private silenceMs = 0;
  private transcript: string[] = [];
  private stopped = false;

  constructor(deps: WakeDictationDependencies) {
    this.deps = deps;
    deps.onPhase(this.phase);
  }

  pushPcm(chunk: string): void {
    if (this.stopped) return;
    if (this.phase === "processing") {
      // Keep speech spoken while STT finishes the previous segment.
      this.queuedChunks.push(chunk);
      if (this.queuedChunks.length > 20) this.queuedChunks.shift();
      return;
    }
    const { rms, durationMs } = pcmEnergy(chunk);
    const speaking = rms >= MIN_RMS;
    if (!this.chunks.length && !speaking) return;

    this.chunks.push(chunk);
    this.utteranceMs += durationMs;
    this.silenceMs = speaking ? 0 : this.silenceMs + durationMs;
    if (this.silenceMs >= END_SILENCE_MS || this.utteranceMs >= MAX_UTTERANCE_MS) {
      const chunks = this.chunks;
      this.chunks = [];
      this.utteranceMs = 0;
      this.silenceMs = 0;
      this.phase = "processing";
      this.deps.onPhase(this.phase);
      void this.process(chunks);
    }
  }

  stop(): void {
    this.stopped = true;
    this.chunks = [];
    this.queuedChunks = [];
    this.transcript = [];
  }

  private async process(chunks: string[]): Promise<void> {
    try {
      const text = (await this.deps.transcribe(chunks)).trim();
      if (this.stopped) return;

      const wasArmed = this.captureStarted === false;
      if (wasArmed) {
        const wake = WAKE_PHRASE.exec(text);
        if (!wake) {
          this.setPhase("armed");
          return;
        }
        this.captureStarted = true;
        const remainder = text.slice(wake.index + wake[0].length).trim();
        if (remainder) await this.acceptDictation(remainder);
        if (!this.stopped && this.captureStarted) this.setPhase("capturing");
        return;
      }

      await this.acceptDictation(text);
      if (!this.stopped && this.captureStarted) this.setPhase("capturing");
    } catch (error) {
      if (!this.stopped)
        this.deps.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      const queued = this.queuedChunks;
      this.queuedChunks = [];
      for (let i = 0; i < queued.length; i++) {
        if (this.stopped) break;
        if (this.phase === "processing") {
          this.queuedChunks.unshift(...queued.slice(i));
          break;
        }
        this.pushPcm(queued[i]);
      }
    }
  }

  private captureStarted = false;

  private async acceptDictation(text: string): Promise<void> {
    const done = DONE_SUFFIX.test(text);
    const content = done ? text.replace(DONE_SUFFIX, "").trim() : text.trim();
    if (content) this.transcript.push(content);
    if (!done) return;

    const complete = this.transcript.join(" ").trim();
    if (complete) {
      await this.deps.copy(complete);
      if (this.stopped) return;
      this.deps.onCopied(complete);
    }
    this.transcript = [];
    this.captureStarted = false;
    this.setPhase("armed");
  }

  private setPhase(phase: WakeDictationPhase): void {
    this.phase = phase;
    this.deps.onPhase(phase);
  }
}
