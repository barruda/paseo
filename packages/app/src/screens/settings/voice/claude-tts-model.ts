// CUSTOM(claude-tts): pure helpers behind the Speaking provider row and the Claude voice picker.
import { previewTextFor } from "./voice-settings-model";

export const CLAUDE_TTS_VOICES = ["buttery", "airy", "mellow", "glassy", "rounded"] as const;
export const DEFAULT_CLAUDE_TTS_VOICE = "buttery";

// A voice the daemon reports that this build doesn't know still renders, under its own name.
export function claudeVoiceOptionIds(current: string | undefined): string[] {
  const ids: string[] = [...CLAUDE_TTS_VOICES];
  if (current && !ids.includes(current)) ids.push(current);
  return ids;
}

export function claudeVoiceValue(current: string | undefined): string {
  return current || DEFAULT_CLAUDE_TTS_VOICE;
}

// The preview reads a sample in the Claude language setting (`pt-BR`, `es`, ...).
export function claudePreviewText(language: string | undefined): string {
  const base = (language ?? "en").toLowerCase().split("-")[0];
  switch (base) {
    case "pt":
      return previewTextFor("ptBR");
    case "es":
      return previewTextFor("es");
    case "fr":
      return previewTextFor("fr");
    case "it":
      return previewTextFor("it");
    case "ja":
      return previewTextFor("ja");
    case "hi":
      return previewTextFor("hi");
    default:
      return previewTextFor("enUS");
  }
}
