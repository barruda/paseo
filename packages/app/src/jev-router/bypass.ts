// CUSTOM(jev-router-bypass): the composer's lock next to the route icon, shown while the router is
// on. It skips Jev for the next session created ("once", cleared when that send consumes it) or
// for every one until pressed again ("always", kept across app runs). "always" also stops a new
// tab from starting on Effort focused's Default pick, so your selection stays as you left it.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

export type JevBypassMode = "off" | "once" | "always";

const STORAGE_KEY = "custom.jev-router.bypass";

export function nextJevBypassMode(mode: JevBypassMode): JevBypassMode {
  if (mode === "off") return "once";
  if (mode === "once") return "always";
  return "off";
}

export const useJevBypassStore = create<{
  mode: JevBypassMode;
  setMode(mode: JevBypassMode): void;
  /** True when this send must skip Jev; a "once" bypass is used up. */
  consume(): boolean;
}>((set, get) => ({
  mode: "off",
  setMode: (mode) => {
    set({ mode });
    // Only "always" outlives the app run; "once" belongs to the message being written.
    AsyncStorage.setItem(STORAGE_KEY, mode === "always" ? "always" : "off").catch(() => {});
  },
  consume: () => {
    const mode = get().mode;
    if (mode === "once") set({ mode: "off" });
    return mode !== "off";
  },
}));

async function restoreBypass(): Promise<void> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
    if (value === "always" && useJevBypassStore.getState().mode === "off") {
      useJevBypassStore.setState({ mode: "always" });
    }
  } catch {
    // No stored bypass: start unlocked.
  }
}

void restoreBypass();
