import { describe, expect, it } from "vitest";
import { chatOptionEnabled } from "@/composer/chat-options";
import { resolveChatOptionsForEmbed } from "@/embed/embed-chat-options";
import { shouldShowDictationButton, shouldShowVoiceModeButton } from "./voice-controls";

const voiceModeBase = {
  isVoiceModeForAgent: false,
  hasAgent: true,
  isCompact: false,
  hasSendableContent: false,
};

describe("composer voice controls", () => {
  it("shows Dictation and Voice mode in the embed", () => {
    const options = resolveChatOptionsForEmbed({}, true);
    expect(
      shouldShowDictationButton({
        showVoice: true,
        dictationEnabled: chatOptionEnabled(options, "dictation"),
        isRealtimeVoiceForCurrentAgent: false,
      }),
    ).toBe(true);
    expect(
      shouldShowVoiceModeButton({
        showVoice: chatOptionEnabled(options, "voice"),
        ...voiceModeBase,
      }),
    ).toBe(true);
  });

  it("keeps both buttons in the normal app", () => {
    const options = resolveChatOptionsForEmbed({}, false);
    expect(
      shouldShowDictationButton({
        showVoice: true,
        dictationEnabled: chatOptionEnabled(options, "dictation"),
        isRealtimeVoiceForCurrentAgent: false,
      }),
    ).toBe(true);
    expect(
      shouldShowVoiceModeButton({
        showVoice: chatOptionEnabled(options, "voice"),
        ...voiceModeBase,
      }),
    ).toBe(true);
  });

  it("shows Dictation while realtime voice is on even when dictation is off", () => {
    expect(
      shouldShowDictationButton({
        showVoice: true,
        dictationEnabled: false,
        isRealtimeVoiceForCurrentAgent: true,
      }),
    ).toBe(true);
  });

  it("hides Voice mode while already in it, or in a compact composer with content", () => {
    expect(
      shouldShowVoiceModeButton({
        showVoice: true,
        ...voiceModeBase,
        isVoiceModeForAgent: true,
      }),
    ).toBe(false);
    expect(
      shouldShowVoiceModeButton({
        showVoice: true,
        ...voiceModeBase,
        isCompact: true,
        hasSendableContent: true,
      }),
    ).toBe(false);
  });

  it("hides both buttons in a terminal composer", () => {
    expect(
      shouldShowDictationButton({
        showVoice: false,
        dictationEnabled: true,
        isRealtimeVoiceForCurrentAgent: false,
      }),
    ).toBe(false);
    expect(shouldShowVoiceModeButton({ showVoice: false, ...voiceModeBase })).toBe(false);
  });
});
