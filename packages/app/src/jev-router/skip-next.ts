// CUSTOM(jev-router): a press on the composer's route icon skips Jev for the next new agent on
// that host only; the router turns itself back on once that agent is created. Turning it off for
// good is the sheet's "Route new sessions". Kept in memory: an app restart clears it.

import { create } from "zustand";

export const useJevSkipNextStore = create<{
  byServer: Record<string, true>;
  toggle(serverId: string): void;
  /** True when this creation must skip Jev; the skip is used up. */
  consume(serverId: string): boolean;
}>((set, get) => ({
  byServer: {},
  toggle: (serverId) =>
    set((state) => {
      const byServer = { ...state.byServer };
      if (byServer[serverId]) delete byServer[serverId];
      else byServer[serverId] = true;
      return { byServer };
    }),
  consume: (serverId) => {
    if (!get().byServer[serverId]) return false;
    get().toggle(serverId);
    return true;
  },
}));
