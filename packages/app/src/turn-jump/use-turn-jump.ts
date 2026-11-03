// CUSTOM(turn-jump): runs a pending turn jump in the chat it names. See model.ts.
import { useEffect } from "react";
import {
  decideTurnJump,
  TURN_JUMP_TTL_MS,
  type TurnJumpPrompt,
  type TurnJumpRequest,
} from "./model";
import { useTurnJumpStore } from "./store";

export function useTurnJumpRequest(serverId: string, agentId: string): TurnJumpRequest | null {
  return useTurnJumpStore((state) =>
    state.request?.serverId === serverId && state.request.agentId === agentId
      ? state.request
      : null,
  );
}

export function useTurnJump(input: {
  request: TurnJumpRequest | null;
  prompts: readonly TurnJumpPrompt[];
  active: boolean;
  jumpToPrompt: (seq: number) => void;
}): void {
  const { request, prompts, active, jumpToPrompt } = input;
  useEffect(() => {
    if (!request) return;
    const { clear } = useTurnJumpStore.getState();
    const decision = decideTurnJump({ request, prompts, active, now: Date.now() });
    if (decision.kind === "wait") {
      const timer = setTimeout(
        () => clear(request),
        Math.max(0, request.requestedAt + TURN_JUMP_TTL_MS - Date.now()),
      );
      return () => clearTimeout(timer);
    }
    clear(request);
    if (decision.kind === "jump") jumpToPrompt(decision.seq);
    return undefined;
  }, [request, prompts, active, jumpToPrompt]);
}
