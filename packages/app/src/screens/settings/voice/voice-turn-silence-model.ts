// CUSTOM(voice-turn-silence): what the "Pause before sending" row offers and when it is locked.
import type { MutableSpeechConfig, SpeechLocalStatus } from "@getpaseo/protocol/speech-settings";

export const DEFAULT_VOICE_TURN_SILENCE_MS = 1000;

export const VOICE_TURN_SILENCE_PRESETS_MS: readonly number[] = [
  500, 800, 1000, 1500, 2000, 3000, 5000,
];

/** The presets plus the current value when an env var or config.json set something else. */
export function voiceTurnSilenceOptionValues(current: number | undefined): number[] {
  const values = new Set(VOICE_TURN_SILENCE_PRESETS_MS);
  if (current !== undefined) values.add(current);
  return [...values].sort((a, b) => a - b);
}

export function formatVoiceTurnSilence(ms: number): string {
  return `${Number((ms / 1000).toFixed(2))} s`;
}

export type VoiceTurnSilenceRowState =
  | { kind: "hidden" }
  | { kind: "editable"; value: number }
  | { kind: "envControlled"; value: number };

/** Hidden when the daemon predates the setting and does not report a value. */
export function voiceTurnSilenceRowState(
  status: SpeechLocalStatus,
  speech: MutableSpeechConfig,
): VoiceTurnSilenceRowState {
  const value = speech.voiceTurnSilenceMs;
  if (value === undefined) return { kind: "hidden" };
  if (status.envControlled.includes("voiceTurnSilenceMs")) return { kind: "envControlled", value };
  return { kind: "editable", value };
}
