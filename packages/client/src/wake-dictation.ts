// CUSTOM(wake-dictation): shared by the app sidebar toggle and `paseo speech wake`; short utterances
// keep it on the existing STT path.
export type WakeDictationPhase = "armed" | "capturing" | "processing";

const MIN_RMS = 0.008;
const END_SILENCE_MS = 900;
const MAX_UTTERANCE_MS = 12_000;
const WAKE_PHRASE = /\bwake[\s,.!?]+up\b[\s,.!?]*/i;
// Any spoken "done" ends the dictation, unless the word before it makes it part of a sentence
// ("I'm done", "get it done", "already done"). The recognizer's punctuation around a spoken
// "done" varies ("4, done, 5", "4, done 5", "1234 done 5678"), so it can't be relied on.
const DONE_WORD = /\bdone\b[.,!?;:]*/gi;
const SENTENCE_BEFORE_DONE = new Set(
  (
    "am i'm im is isn't are aren't was wasn't were weren't be been being get gets got getting " +
    "have has had haven't hasn't it it's that's what's we're you're they're he's she's well " +
    "not all almost already just half nearly finally never gotta"
  ).split(" "),
);

function findDone(text: string): RegExpExecArray | null {
  DONE_WORD.lastIndex = 0;
  for (let match = DONE_WORD.exec(text); match; match = DONE_WORD.exec(text)) {
    const before = text.slice(0, match.index).trimEnd();
    const previous = /([\w'’]+)$/.exec(before)?.[1]?.toLowerCase().replaceAll("’", "'");
    if (!previous || !SENTENCE_BEFORE_DONE.has(previous)) return match;
  }
  return null;
}

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

      await this.handleText(text);
      if (!this.stopped) this.setPhase(this.captureStarted ? "capturing" : "armed");
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

  /** Text after "done" goes back to waiting, so "done, wake up, more" starts a new dictation. */
  private async handleText(text: string): Promise<void> {
    let rest = text;
    while (rest && !this.stopped) {
      if (!this.captureStarted) {
        const wake = WAKE_PHRASE.exec(rest);
        if (!wake) return;
        this.captureStarted = true;
        rest = rest.slice(wake.index + wake[0].length).trim();
        continue;
      }
      const done = findDone(rest);
      if (!done) {
        this.transcript.push(rest);
        return;
      }
      // Drop the comma of "six, done" but keep the period of "send it. Done.".
      const content = rest
        .slice(0, done.index)
        .trim()
        .replace(/[,;:]+$/, "");
      if (content) this.transcript.push(content);
      await this.copyTranscript();
      rest = rest.slice(done.index + done[0].length).trim();
    }
  }

  private async copyTranscript(): Promise<void> {
    const complete = this.transcript.join(" ").trim();
    this.transcript = [];
    this.captureStarted = false;
    if (!complete) return;
    await this.deps.copy(complete);
    if (!this.stopped) this.deps.onCopied(complete);
  }

  private setPhase(phase: WakeDictationPhase): void {
    this.phase = phase;
    this.deps.onPhase(phase);
  }
}
