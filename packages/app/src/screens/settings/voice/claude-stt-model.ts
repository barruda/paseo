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

// Each language is named in itself, so the list reads the same in every app language.
export const CLAUDE_STT_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "en", label: "English" },
  { value: "pt", label: "Português" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
  { value: "ja", label: "日本語" },
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

export type ClaudeUsage = "both" | "dictation" | "voice" | "none";

// Which features transcribe with Claude, for the hint under the Claude section's title.
export function claudeUsage(
  dictationProvider: string | undefined,
  voiceProvider: string | undefined,
): ClaudeUsage {
  const dictation = usesClaude(dictationProvider);
  const voice = usesClaude(voiceProvider);
  if (dictation && voice) return "both";
  if (dictation) return "dictation";
  return voice ? "voice" : "none";
}
