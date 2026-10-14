// CUSTOM(voice-settings): turns a sound file the user picked into the thinking tone's format
// (PCM16 mono at 16 kHz), so it plays and scales its volume like the built-in tone.
import { THINKING_TONE_MAX_SECONDS, THINKING_TONE_PCM_SAMPLE_RATE } from "./thinking-tone-settings";

export const canPickThinkingToneFile = true;

export async function decodeThinkingToneFile(data: ArrayBuffer): Promise<Uint8Array> {
  const decodingContext = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodingContext.decodeAudioData(data.slice(0));
  } finally {
    void decodingContext.close();
  }
  const seconds = Math.min(decoded.duration, THINKING_TONE_MAX_SECONDS);
  const frames = Math.max(1, Math.ceil(seconds * THINKING_TONE_PCM_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, THINKING_TONE_PCM_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = (await offline.startRendering()).getChannelData(0);
  const pcm = new Int16Array(rendered.length);
  for (let i = 0; i < rendered.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, rendered[i] ?? 0));
    pcm[i] = Math.round(sample * 0x7fff);
  }
  return new Uint8Array(pcm.buffer);
}
