// CUSTOM(claude-stt): settings for the Claude speech-to-text provider, the service behind
// Claude Code's /voice. It signs in with the Claude.ai login of a Claude Code config folder.
import type { PersistedConfig } from "../../../persisted-config.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";
import { clampClaudeTtsSpeed, resolveClaudeTtsVoice } from "./tts.js";

export const DEFAULT_CLAUDE_STT_LANGUAGE = "en";

export interface ClaudeSpeechConfig {
  // Claude Code config folder whose `.credentials.json` holds the login. Unset means
  // $CLAUDE_CONFIG_DIR, then ~/.claude.
  configDir?: string;
  language: string;
  // Words the recognizer should favor: project names, jargon.
  keyterms: string[];
  // CUSTOM(claude-tts): the voice and speed of the speaking provider.
  tts: { voice: string; speed: number };
}

export function claudeSttInUse(providers: RequestedSpeechProviders): boolean {
  return (
    (providers.dictationStt.enabled !== false && providers.dictationStt.provider === "claude") ||
    (providers.voiceStt.enabled !== false && providers.voiceStt.provider === "claude")
  );
}

export function resolveClaudeSpeechConfig(params: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
}): ClaudeSpeechConfig {
  const saved = params.persisted.providers?.claude;
  const configDir = params.env.PASEO_CLAUDE_STT_CONFIG_DIR?.trim() || saved?.configDir?.trim();
  const language =
    params.env.PASEO_CLAUDE_STT_LANGUAGE?.trim() ||
    saved?.language?.trim() ||
    DEFAULT_CLAUDE_STT_LANGUAGE;
  return {
    ...(configDir ? { configDir } : {}),
    language,
    keyterms: normalizeKeyterms(saved?.keyterms ?? []),
    tts: resolveClaudeTtsSettings(params.persisted),
  };
}

// CUSTOM(claude-tts): read from the voice mode speaking site, whichever provider it is on, so
// a voice picked earlier is there when Claude is switched on.
function resolveClaudeTtsSettings(persisted: PersistedConfig): ClaudeSpeechConfig["tts"] {
  const site = persisted.features?.voiceMode?.tts;
  const claudeSite = site?.provider === "claude" ? site : undefined;
  return {
    voice: resolveClaudeTtsVoice(claudeSite?.voice),
    speed: clampClaudeTtsSpeed(claudeSite?.speed),
  };
}

export function normalizeKeyterms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of terms) {
    const trimmed = term.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
