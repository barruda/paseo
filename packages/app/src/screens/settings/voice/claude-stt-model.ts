// CUSTOM(claude-stt): pure helpers behind the Speech-to-text provider section.
import type { ClaudeSttStatus } from "@getpaseo/protocol/speech-settings";

export type SttProviderId = "local" | "claude" | "openai";

// OpenAI only exists in a hand-edited config; it shows up when the daemon reports it so the
// value renders, but Settings never offers to switch to it.
export function sttProviderOptionIds(current: string | undefined): string[] {
  const ids: string[] = ["local", "claude"];
  if (current !== undefined && !ids.includes(current)) ids.push(current);
  return ids;
}

// The 20 languages Claude Code's voice supports, each named in itself so the list reads the
// same in every app language, plus pt-BR: Claude Code itself only sends `pt`, but the service
// accepts the regional code too, kept here to compare the two.
export const CLAUDE_STT_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "ja", label: "日本語" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "it", label: "Italiano" },
  { value: "ko", label: "한국어" },
  { value: "hi", label: "हिन्दी" },
  { value: "id", label: "Bahasa Indonesia" },
  { value: "ru", label: "Русский" },
  { value: "pl", label: "Polski" },
  { value: "tr", label: "Türkçe" },
  { value: "nl", label: "Nederlands" },
  { value: "uk", label: "Українська" },
  { value: "el", label: "Ελληνικά" },
  { value: "cs", label: "Čeština" },
  { value: "da", label: "Dansk" },
  { value: "sv", label: "Svenska" },
  { value: "no", label: "Norsk" },
];

export function claudeLanguageOptions(
  current: string | undefined,
): Array<{ value: string; label: string }> {
  const options = [...CLAUDE_STT_LANGUAGES];
  if (current && !options.some((option) => option.value === current)) {
    options.push({ value: current, label: current });
  }
  return options;
}

// Comma- or newline-separated; blank entries and repeats drop out.
export function parseKeyterms(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const term = raw.trim();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

export function formatKeyterms(terms: readonly string[] | undefined): string {
  return (terms ?? []).join(", ");
}

export function sameTerms(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((term, index) => term === b[index]);
}

export type ClaudeLoginState =
  | { kind: "signedIn"; plan: string | null; path: string }
  | { kind: "error"; message: string };

export function describeClaudeLogin(status: ClaudeSttStatus): ClaudeLoginState {
  if (status.signedIn) {
    return { kind: "signedIn", plan: status.subscriptionType, path: status.credentialsPath };
  }
  return { kind: "error", message: status.error ?? status.credentialsPath };
}

export function usesClaude(provider: string | undefined): boolean {
  return provider === "claude";
}

// A local model picker shows only while the feature uses Local STT. Old daemons report no
// provider and always show it.
export function showsLocalModel(provider: string | undefined): boolean {
  return provider === undefined || provider === "local";
}

// CUSTOM(claude-tts): the features a Claude login serves, in the order Settings lists them.
export type ClaudeFeature = "dictation" | "listening" | "speaking";

// Which features use Claude, for the hint under the Claude section's title.
export function claudeFeatures(params: {
  dictationProvider: string | undefined;
  listeningProvider: string | undefined;
  speakingProvider: string | undefined;
}): ClaudeFeature[] {
  const features: ClaudeFeature[] = [];
  if (usesClaude(params.dictationProvider)) features.push("dictation");
  if (usesClaude(params.listeningProvider)) features.push("listening");
  if (usesClaude(params.speakingProvider)) features.push("speaking");
  return features;
}
