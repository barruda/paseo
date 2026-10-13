// CUSTOM(voice-settings): the thinking tone voice mode plays while the agent works, set per
// device in Settings > Voice and dictation. Kept in its own store so the app settings schema
// stays upstream's.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export type ThinkingToneVolume = "low" | "medium" | "high";

export interface ThinkingToneSettings {
  enabled: boolean;
  volume: ThinkingToneVolume;
}

interface ThinkingToneStore extends ThinkingToneSettings {
  update: (patch: Partial<ThinkingToneSettings>) => void;
}

export const DEFAULT_THINKING_TONE: ThinkingToneSettings = { enabled: true, volume: "high" };

const GAIN_BY_VOLUME: Record<ThinkingToneVolume, number> = {
  low: 0.3,
  medium: 0.6,
  high: 1,
};

const StoredThinkingToneSchema = z.object({
  enabled: z.boolean(),
  volume: z.enum(["low", "medium", "high"]),
});

export const useThinkingToneStore = create<ThinkingToneStore>()(
  persist(
    (set) => ({
      ...DEFAULT_THINKING_TONE,
      update: (patch) => set(patch),
    }),
    {
      name: "voice-thinking-tone",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, StoredThinkingToneSchema),
      partialize: (state) => ({ enabled: state.enabled, volume: state.volume }),
    },
  ),
);

export function thinkingToneGain(volume: ThinkingToneVolume): number {
  return GAIN_BY_VOLUME[volume];
}

// Scales little-endian PCM16 samples; the tone ships at full volume.
export function scalePcm16(pcm: Uint8Array, gain: number): Uint8Array {
  if (gain >= 1) return pcm;
  const out = new Uint8Array(pcm.byteLength);
  const input = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const output = new DataView(out.buffer);
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
    output.setInt16(offset, Math.round(input.getInt16(offset, true) * gain), true);
  }
  return out;
}
