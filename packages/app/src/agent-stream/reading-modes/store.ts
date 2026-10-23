// CUSTOM(reading-modes): which reading mode each agent's chat is in. In memory only: a reload
// returns every chat to the normal view.
import { useMemo } from "react";
import { create } from "zustand";
import type { StreamItem } from "@/types/stream";
import { filterCompactStream, type ReadingMode } from "./model";

interface ReadingModeState {
  modeByAgentId: Record<string, Exclude<ReadingMode, "chat">>;
  toggle: (agentId: string, mode: Exclude<ReadingMode, "chat">) => void;
  reset: (agentId: string) => void;
}

export const useReadingModeStore = create<ReadingModeState>((set) => ({
  modeByAgentId: {},
  toggle: (agentId, mode) =>
    set((state) => {
      const { [agentId]: current, ...rest } = state.modeByAgentId;
      return { modeByAgentId: current === mode ? rest : { ...rest, [agentId]: mode } };
    }),
  reset: (agentId) =>
    set((state) => {
      if (!(agentId in state.modeByAgentId)) return state;
      const { [agentId]: _removed, ...rest } = state.modeByAgentId;
      return { modeByAgentId: rest };
    }),
}));

export function useReadingMode(agentId: string): ReadingMode {
  return useReadingModeStore((state) => state.modeByAgentId[agentId] ?? "chat");
}

/** The stream the chat renders: Compact filters it, the other modes pass it through. */
export function useReadingModeStream(
  agentId: string,
  tail: StreamItem[],
  head: StreamItem[] | undefined,
): { mode: ReadingMode; tail: StreamItem[]; head: StreamItem[] | undefined } {
  const mode = useReadingMode(agentId);
  return useMemo(
    () =>
      mode === "compact" ? { mode, ...filterCompactStream(tail, head) } : { mode, tail, head },
    [mode, tail, head],
  );
}
