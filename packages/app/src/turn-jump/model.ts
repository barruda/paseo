// CUSTOM(turn-jump): a plugin asks to open an agent at the turn that started at a given time (the
// token ledger's turn rows). The chat outline's prompt index has every prompt's timestamp, so the
// turn's prompt is found by time and old ledger rows, which never stored a timeline seq, still
// jump.

export interface TurnJumpRequest {
  serverId: string;
  agentId: string;
  /** When the turn started, as the daemon recorded it (ISO). */
  turnStartedAt: string;
  /** `Date.now()` when the jump was asked for. */
  requestedAt: number;
}

export interface TurnJumpPrompt {
  seq: number;
  timestamp: string;
}

/** A prompt can be written to the timeline a moment after the turn's start event. */
export const TURN_PROMPT_SLACK_MS = 5_000;
/** A jump that hasn't found its chat by then is dropped, so it can't fire on a later visit. */
export const TURN_JUMP_TTL_MS = 15_000;

/** The turn's prompt: the last prompt at or before the turn's start, allowing for the slack. */
export function findTurnPromptSeq(
  prompts: readonly TurnJumpPrompt[],
  turnStartedAt: string,
): number | null {
  const start = Date.parse(turnStartedAt);
  if (Number.isNaN(start)) return null;
  let best: TurnJumpPrompt | null = null;
  for (const prompt of prompts) {
    const at = Date.parse(prompt.timestamp);
    if (Number.isNaN(at) || at > start + TURN_PROMPT_SLACK_MS) continue;
    if (
      !best ||
      at > Date.parse(best.timestamp) ||
      (at === Date.parse(best.timestamp) && prompt.seq > best.seq)
    ) {
      best = prompt;
    }
  }
  return best?.seq ?? null;
}

export type TurnJumpDecision = { kind: "wait" } | { kind: "drop" } | { kind: "jump"; seq: number };

export function decideTurnJump(input: {
  request: TurnJumpRequest;
  prompts: readonly TurnJumpPrompt[];
  active: boolean;
  now: number;
}): TurnJumpDecision {
  if (input.now - input.request.requestedAt > TURN_JUMP_TTL_MS) return { kind: "drop" };
  // The prompt index loads after the chat opens; an inactive chat can't scroll.
  if (!input.active || input.prompts.length === 0) return { kind: "wait" };
  const seq = findTurnPromptSeq(input.prompts, input.request.turnStartedAt);
  return seq === null ? { kind: "drop" } : { kind: "jump", seq };
}

/** The outline's prompt index also serves a pending turn jump when the user hid the outline. */
export function shouldLoadChatOutline(input: {
  supported: boolean;
  enabled: boolean;
  turnJump: TurnJumpRequest | null;
}): boolean {
  return input.supported && (input.enabled || input.turnJump !== null);
}
