import { create } from "zustand";
import type { AgentControlCommandCenterSource } from "@/command-center/agent-control-registration";
import type { ModelPickerProjectSource } from "./project";

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
  /** CUSTOM(model-picker-project): set when the composer is a new conversation. */
  project: ModelPickerProjectSource | null;
  pendingEffort: PendingModelPickerEffort | null;
  open(
    sourceId: string,
    controls: AgentControlCommandCenterSource,
    project?: ModelPickerProjectSource | null,
  ): void;
  update(
    sourceId: string,
    controls: AgentControlCommandCenterSource,
    project?: ModelPickerProjectSource | null,
  ): void;
  close(): void;
  setPendingEffort(pending: PendingModelPickerEffort | null): void;
}

export const PENDING_EFFORT_TTL_MS = 15_000;

export const useModelPickerStore = create<ModelPickerState>()((set, get) => ({
  sourceId: null,
  controls: null,
  project: null,
  pendingEffort: null,
  open: (sourceId, controls, project = null) =>
    set({ sourceId, controls, project, pendingEffort: null }),
  update: (sourceId, controls, project = null) => {
    const state = get();
    if (state.sourceId !== sourceId) return;
    if (state.controls === controls && state.project === project) return;
    set({ controls, project });
  },
  close: () => set({ sourceId: null, controls: null, project: null }),
  setPendingEffort: (pendingEffort) => set({ pendingEffort }),
}));
