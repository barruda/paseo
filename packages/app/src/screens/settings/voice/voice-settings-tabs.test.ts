import { describe, expect, it } from "vitest";

import {
  DEFAULT_VOICE_SETTINGS_TAB,
  parseVoiceSettingsTab,
  VOICE_SETTINGS_TABS,
} from "./voice-settings-tabs";

describe("voice settings tabs", () => {
  it("opens Dictation by default", () => {
    expect(DEFAULT_VOICE_SETTINGS_TAB).toBe("dictation");
    expect(VOICE_SETTINGS_TABS[0]).toBe("dictation");
  });

  it("keeps a known tab and falls back to Dictation for anything else", () => {
    expect(parseVoiceSettingsTab("claude")).toBe("claude");
    expect(parseVoiceSettingsTab("status")).toBe("status");
    expect(parseVoiceSettingsTab("nope")).toBe("dictation");
    expect(parseVoiceSettingsTab(undefined)).toBe("dictation");
    expect(parseVoiceSettingsTab(3)).toBe("dictation");
  });
});
