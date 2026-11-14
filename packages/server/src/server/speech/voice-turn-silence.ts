// CUSTOM(voice-turn-silence): how long a silence after speech ends a voice-mode turn, editable in
// Settings > Voice and dictation. An env var wins over config.json, which wins over the default.
import type { PersistedConfig } from "../persisted-config.js";

export const DEFAULT_VOICE_TURN_SILENCE_MS = 1000;
export const VOICE_TURN_SILENCE_ENV = "PASEO_VOICE_TURN_SILENCE_MS";

export function resolveVoiceTurnSilenceMs(params: {
  env: NodeJS.ProcessEnv;
  saved?: NonNullable<NonNullable<PersistedConfig["features"]>["voiceMode"]>["turnDetection"];
}): number {
  const raw = params.env[VOICE_TURN_SILENCE_ENV];
  const parsed = raw !== undefined && raw.trim() ? Number.parseFloat(raw) : Number.NaN;
  const fromEnv = Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  return Math.round(fromEnv ?? params.saved?.silenceMs ?? DEFAULT_VOICE_TURN_SILENCE_MS);
}
