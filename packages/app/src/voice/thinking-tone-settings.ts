// CUSTOM(voice-settings): the thinking tone voice mode plays while the agent works, set per
// device in Settings > Voice and dictation. Kept in its own store so the app settings schema
// stays upstream's.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export type ThinkingToneVolume = "low" | "medium" | "high";

// A sound the user picked, decoded to the tone's format: PCM16 mono at 16 kHz.
export interface ThinkingToneCustomSound {
  name: string;
  pcmBase64: string;
}

export interface ThinkingToneSettings {
  enabled: boolean;
  volume: ThinkingToneVolume;
  // Silence between two plays while the agent works.
  intervalSeconds: number;
  customSound: ThinkingToneCustomSound | null;
}

interface ThinkingToneStore extends ThinkingToneSettings {
  update: (patch: Partial<ThinkingToneSettings>) => void;
}

export const DEFAULT_THINKING_TONE: ThinkingToneSettings = {
  enabled: true,
  volume: "high",
  intervalSeconds: 10,
  customSound: null,
};

export const THINKING_TONE_INTERVAL_SECONDS = [3, 5, 10, 20, 30, 60] as const;
export const THINKING_TONE_PCM_SAMPLE_RATE = 16000;
// Longer picks are cut; the tone plays while the agent works, not as music.
export const THINKING_TONE_MAX_SECONDS = 10;

const GAIN_BY_VOLUME: Record<ThinkingToneVolume, number> = {
  low: 0.3,
  medium: 0.6,
  high: 1,
};

const StoredThinkingToneSchema = z.object({
  enabled: z.boolean(),
  volume: z.enum(["low", "medium", "high"]),
  // Optional: v1 stored only the two fields above.
  intervalSeconds: z.number().positive().optional(),
  customSound: z.object({ name: z.string(), pcmBase64: z.string() }).nullable().optional(),
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
      partialize: (state) => ({
        enabled: state.enabled,
        volume: state.volume,
        intervalSeconds: state.intervalSeconds,
        customSound: state.customSound,
      }),
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
