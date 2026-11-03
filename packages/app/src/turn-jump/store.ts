// CUSTOM(turn-jump): the one pending "open this agent at that turn" request. See model.ts.
import { create } from "zustand";
import type { TurnJumpRequest } from "./model";

interface TurnJumpState {
  request: TurnJumpRequest | null;
  clear(request: TurnJumpRequest): void;
}

export const useTurnJumpStore = create<TurnJumpState>()((set) => ({
  request: null,
  clear: (request) => set((state) => (state.request === request ? { request: null } : state)),
}));

export function requestTurnJump(input: Omit<TurnJumpRequest, "requestedAt">): void {
  useTurnJumpStore.setState({ request: { ...input, requestedAt: Date.now() } });
}
