// CUSTOM(voice-tabs): the tab Settings > Voice and Dictation was last left on, per device.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  DEFAULT_VOICE_SETTINGS_TAB,
  parseVoiceSettingsTab,
  type VoiceSettingsTab,
} from "@/screens/settings/voice/voice-settings-tabs";

interface VoiceSettingsTabStore {
  tab: VoiceSettingsTab;
  setTab: (tab: VoiceSettingsTab) => void;
}

// Any string loads; an unknown tab name becomes Dictation when it is read.
const StoredTabSchema = z.object({ tab: z.string() });

export const useVoiceSettingsTabStore = create<VoiceSettingsTabStore>()(
  persist(
    (set) => ({
      tab: DEFAULT_VOICE_SETTINGS_TAB,
      setTab: (tab) => set({ tab }),
    }),
    {
      name: "voice-settings-tab",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, StoredTabSchema),
      partialize: (state) => ({ tab: state.tab }),
      merge: (stored, current) => ({
        ...current,
        tab: parseVoiceSettingsTab((stored as { tab?: unknown } | undefined)?.tab),
      }),
    },
  ),
);
