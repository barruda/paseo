// CUSTOM(voice-settings): native has no Web Audio decoder; it keeps the built-in tone.
export const canPickThinkingToneFile = false;

export async function decodeThinkingToneFile(_data: ArrayBuffer): Promise<Uint8Array> {
  throw new Error("Picking a thinking tone file needs the web or desktop app");
}
