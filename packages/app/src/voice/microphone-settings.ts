// CUSTOM(voice-settings): the browser audio processing voice mode asks for when it opens
// the microphone, set per device in Settings > Voice and dictation. Speakerphones and
// headsets cancel echo themselves; stacking the browser's echo canceller on top of theirs
// treats the user's voice as echo while the agent talks, so interrupting it fails.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export interface VoiceMicrophoneSettings {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

interface VoiceMicrophoneStore extends VoiceMicrophoneSettings {
  update: (patch: Partial<VoiceMicrophoneSettings>) => void;
}

export const DEFAULT_VOICE_MICROPHONE: VoiceMicrophoneSettings = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const StoredVoiceMicrophoneSchema = z.object({
  echoCancellation: z.boolean(),
  noiseSuppression: z.boolean(),
  autoGainControl: z.boolean(),
});

export const useVoiceMicrophoneStore = create<VoiceMicrophoneStore>()(
  persist(
    (set) => ({
      ...DEFAULT_VOICE_MICROPHONE,
      update: (patch) => set(patch),
    }),
    {
      name: "voice-microphone",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, StoredVoiceMicrophoneSchema),
      partialize: (state) => ({
        echoCancellation: state.echoCancellation,
        noiseSuppression: state.noiseSuppression,
        autoGainControl: state.autoGainControl,
      }),
    },
  ),
);

export function getVoiceMicrophoneSettings(): VoiceMicrophoneSettings {
  const { echoCancellation, noiseSuppression, autoGainControl } =
    useVoiceMicrophoneStore.getState();
  return { echoCancellation, noiseSuppression, autoGainControl };
}

export function sameVoiceMicrophoneSettings(
  a: VoiceMicrophoneSettings,
  b: VoiceMicrophoneSettings,
): boolean {
  return (
    a.echoCancellation === b.echoCancellation &&
    a.noiseSuppression === b.noiseSuppression &&
    a.autoGainControl === b.autoGainControl
  );
}
