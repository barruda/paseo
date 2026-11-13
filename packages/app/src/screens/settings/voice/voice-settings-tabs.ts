// CUSTOM(voice-tabs): the tabs of Settings > Voice and Dictation. The last one picked is kept
// per device in voice/voice-settings-tab.ts.
export const VOICE_SETTINGS_TABS = [
  "dictation",
  "voiceMode",
  "claude",
  "localEngine",
  "status",
] as const;

export type VoiceSettingsTab = (typeof VOICE_SETTINGS_TABS)[number];

export const DEFAULT_VOICE_SETTINGS_TAB: VoiceSettingsTab = "dictation";

// Anything stored that isn't a known tab (older builds, edited storage) opens Dictation.
export function parseVoiceSettingsTab(value: unknown): VoiceSettingsTab {
  return VOICE_SETTINGS_TABS.find((tab) => tab === value) ?? DEFAULT_VOICE_SETTINGS_TAB;
}
