import { create } from "zustand";
import type { CriticConfig } from "@getpaseo/protocol/critic";

// CUSTOM(critic): after the critic is turned on or off, the user's next message to that agent
// carries a short notice saying so (see `buildCriticNotice`). Turning it on and back off before
// sending cancels out. Kept in memory: a restart before the next message drops the notice.

interface CriticStoreState {
  /** agentId → true: tell the agent the critic is on; false: tell it the critic is off. */
  pendingNotice: Record<string, boolean>;
  /** Records a toggle. A toggle back to the state the agent last heard about clears the notice. */
  toggleNotice: (agentId: string, enabled: boolean) => void;
  /** The notice to send with the agent's next message, or undefined when none is pending. */
  peekNotice: (agentId: string) => boolean | undefined;
  consumeNotice: (agentId: string) => void;
  /** agentId → "provider/model" of its critic, as last loaded or saved, for the tooltip. */
  models: Record<string, string>;
  setModel: (agentId: string, model: string) => void;
  /**
   * CUSTOM(draft-composer-ready): draft key → the critic set up before the session exists. The
   * draft's create request applies it (see `./draft.ts`); kept in memory like the notices.
   */
  drafts: Record<string, CriticDraftSetup>;
  setDraft: (draftKey: string, setup: CriticDraftSetup) => void;
  takeDraft: (draftKey: string) => CriticDraftSetup | undefined;
}

export interface CriticDraftSetup {
  config: CriticConfig;
  saveAsDefault: boolean;
}

export const useCriticStore = create<CriticStoreState>()((set, get) => ({
  pendingNotice: {},
  toggleNotice: (agentId, enabled) => {
    set((state) => {
      const pending = { ...state.pendingNotice };
      if (agentId in pending && pending[agentId] !== enabled) delete pending[agentId];
      else pending[agentId] = enabled;
      return { pendingNotice: pending };
    });
  },
  peekNotice: (agentId) => get().pendingNotice[agentId],
  models: {},
  setModel: (agentId, model) => {
    set((state) =>
      state.models[agentId] === model ? state : { models: { ...state.models, [agentId]: model } },
    );
  },
  drafts: {},
  setDraft: (draftKey, setup) => {
    set((state) => ({ drafts: { ...state.drafts, [draftKey]: setup } }));
  },
  takeDraft: (draftKey) => {
    const setup = get().drafts[draftKey];
    if (setup) {
      set((state) => {
        const drafts = { ...state.drafts };
        delete drafts[draftKey];
        return { drafts };
      });
    }
    return setup;
  },
  consumeNotice: (agentId) => {
    set((state) => {
      if (!(agentId in state.pendingNotice)) return state;
      const pending = { ...state.pendingNotice };
      delete pending[agentId];
      return { pendingNotice: pending };
    });
  },
}));
