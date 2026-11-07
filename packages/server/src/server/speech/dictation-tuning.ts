// CUSTOM(dictation-tuning): how dictation cuts and re-transcribes its audio, editable in
// Settings > Voice and dictation. An env var wins over config.json, which wins over the default.
import type { PersistedConfig } from "../persisted-config.js";

type SavedDictationTuning = NonNullable<
  NonNullable<NonNullable<PersistedConfig["features"]>["dictation"]>["tuning"]
>;

export interface DictationTuning {
  /** Seconds of audio before the current segment is closed and its text frozen. 0 turns it off. */
  autoCommitSeconds: number;
  /** PCM16 peak below which a segment counts as silence and is dropped. */
  silencePeakThreshold: number;
  /** Minimum time between re-transcriptions of the open segment (local models). */
  decodeIntervalMs: number;
  /** Instructions sent with each segment (OpenAI). */
  prompt: string;
}

export type DictationTuningField = keyof DictationTuning;

export const DEFAULT_DICTATION_TUNING: DictationTuning = {
  autoCommitSeconds: 15,
  silencePeakThreshold: 300,
  decodeIntervalMs: 350,
  prompt:
    "Transcribe only what the speaker says. Do not add words. Preserve punctuation and casing. If the audio is silence or non-speech noise, return an empty transcript.",
};

export const DICTATION_TUNING_ENV: Record<DictationTuningField, string> = {
  autoCommitSeconds: "PASEO_DICTATION_AUTO_COMMIT_SECONDS",
  silencePeakThreshold: "PASEO_DICTATION_SILENCE_PEAK_THRESHOLD",
  decodeIntervalMs: "PASEO_DICTATION_DECODE_INTERVAL_MS",
  prompt: "PASEO_DICTATION_TRANSCRIPTION_PROMPT",
};

function parseNonNegative(value: string | undefined): number | undefined {
  if (value === undefined || !value.trim()) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function resolveDictationTuning(params: {
  env: NodeJS.ProcessEnv;
  saved?: SavedDictationTuning;
}): DictationTuning {
  const { env } = params;
  const saved = params.saved ?? {};
  const envNumber = (field: Exclude<DictationTuningField, "prompt">) =>
    parseNonNegative(env[DICTATION_TUNING_ENV[field]]);
  return {
    autoCommitSeconds:
      envNumber("autoCommitSeconds") ??
      saved.autoCommitSeconds ??
      DEFAULT_DICTATION_TUNING.autoCommitSeconds,
    silencePeakThreshold: Math.round(
      envNumber("silencePeakThreshold") ??
        saved.silencePeakThreshold ??
        DEFAULT_DICTATION_TUNING.silencePeakThreshold,
    ),
    decodeIntervalMs: Math.round(
      envNumber("decodeIntervalMs") ??
        saved.decodeIntervalMs ??
        DEFAULT_DICTATION_TUNING.decodeIntervalMs,
    ),
    prompt: env[DICTATION_TUNING_ENV.prompt] ?? saved.prompt ?? DEFAULT_DICTATION_TUNING.prompt,
  };
}

/**
 * Which fields the dictation provider reads. The local engine re-transcribes the open segment
 * from scratch on a timer and takes no prompt; OpenAI transcribes each closed segment once,
 * with the prompt, and sends no partial text in between.
 */
export function dictationTuningSupport(provider: string): Record<DictationTuningField, boolean> {
  const local = provider === "local";
  return {
    autoCommitSeconds: true,
    silencePeakThreshold: true,
    decodeIntervalMs: local,
    prompt: provider === "openai",
  };
}
