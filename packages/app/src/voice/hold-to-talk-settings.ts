// CUSTOM(voice-hold-to-talk): "Hold to talk" in Settings > Voice and dictation, per device. When
// on, voice mode streams microphone audio only while the talk key or button is held. Its own
// store keeps the app settings schema upstream's.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface HoldToTalkStore {
  holdToTalkOnly: boolean;
  setHoldToTalkOnly: (value: boolean) => void;
}

const StoredHoldToTalkSchema = z.object({ holdToTalkOnly: z.boolean() });

export const useHoldToTalkStore = create<HoldToTalkStore>()(
  persist(
    (set) => ({
      holdToTalkOnly: false,
      setHoldToTalkOnly: (value) => set({ holdToTalkOnly: value }),
    }),
    {
      name: "voice-hold-to-talk",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, StoredHoldToTalkSchema),
      partialize: (state) => ({ holdToTalkOnly: state.holdToTalkOnly }),
    },
  ),
);
