import { create } from "zustand";
import type { AgentControlCommandCenterSource } from "@/command-center/agent-control-registration";

/** An effort to set once the composer named by `sourceId` has switched to the given model. */
export interface PendingModelPickerEffort {
  sourceId: string;
  provider: string;
  modelId: string;
  effortId: string;
  expiresAt: number;
}

interface ModelPickerState {
  /** The composer the open picker acts on, or null when the picker is closed. */
  sourceId: string | null;
  controls: AgentControlCommandCenterSource | null;
  pendingEffort: PendingModelPickerEffort | null;
  open(sourceId: string, controls: AgentControlCommandCenterSource): void;
  update(sourceId: string, controls: AgentControlCommandCenterSource): void;
  close(): void;
  setPendingEffort(pending: PendingModelPickerEffort | null): void;
}

export const PENDING_EFFORT_TTL_MS = 15_000;

export const useModelPickerStore = create<ModelPickerState>()((set, get) => ({
  sourceId: null,
  controls: null,
  pendingEffort: null,
  open: (sourceId, controls) => set({ sourceId, controls, pendingEffort: null }),
  update: (sourceId, controls) => {
    if (get().sourceId !== sourceId || get().controls === controls) return;
    set({ controls });
  },
  close: () => set({ sourceId: null, controls: null }),
  setPendingEffort: (pendingEffort) => set({ pendingEffort }),
}));
