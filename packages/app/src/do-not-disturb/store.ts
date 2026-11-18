// CUSTOM(do-not-disturb): renderer mirror of the state the Electron main process owns.
import { create } from "zustand";
import {
  DO_NOT_DISTURB_OFF,
  isDoNotDisturbActive,
  type DoNotDisturbDuration,
  type DoNotDisturbState,
} from "@getpaseo/protocol/do-not-disturb";
import { getIsElectron } from "@/constants/platform";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";

interface DoNotDisturbStoreState {
  state: DoNotDisturbState;
  setState: (state: DoNotDisturbState) => void;
}

export const useDoNotDisturbStore = create<DoNotDisturbStoreState>((set) => ({
  state: DO_NOT_DISTURB_OFF,
  setState: (state) => set({ state }),
}));

export function isDoNotDisturbActiveNow(nowMs: number = Date.now()): boolean {
  return isDoNotDisturbActive(useDoNotDisturbStore.getState().state, nowMs);
}

export type SetDoNotDisturbArgs =
  | { action: "on"; duration?: DoNotDisturbDuration }
  | { action: "off" }
  | { action: "toggle" };

export async function setDoNotDisturb(args: SetDoNotDisturbArgs): Promise<void> {
  if (!getIsElectron()) return;
  try {
    const next = await invokeDesktopCommand<DoNotDisturbState>("set_do_not_disturb", args);
    useDoNotDisturbStore.getState().setState(next);
  } catch (error) {
    console.warn("[DoNotDisturb] Failed to update Do Not Disturb", error);
  }
}
