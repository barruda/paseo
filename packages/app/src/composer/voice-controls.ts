// The two voice buttons share their gates between the composer's right slot and the input
// toolbar, so the embed customization can test what the user actually sees.

export function shouldShowDictationButton(input: {
  showVoice: boolean;
  dictationEnabled: boolean;
  isRealtimeVoiceForCurrentAgent: boolean;
}): boolean {
  return input.showVoice && (input.dictationEnabled || input.isRealtimeVoiceForCurrentAgent);
}

export function shouldShowVoiceModeButton(input: {
  showVoice: boolean;
  isVoiceModeForAgent: boolean;
  hasAgent: boolean;
  isCompact: boolean;
  hasSendableContent: boolean;
}): boolean {
  const hideVoiceForCompactInput = input.isCompact && input.hasSendableContent;
  return (
    input.showVoice && !input.isVoiceModeForAgent && input.hasAgent && !hideVoiceForCompactInput
  );
}
