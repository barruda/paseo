// CUSTOM(pm-cards-look): which look each option tile of a question takes. Pure, so the chat card and
// the PM board's card agree and the rules (resolved, picked, sending, locked, faded) are tested.

export interface OptionTileInput {
  optionId: string;
  /** The id the PM recommends, if any. */
  recommend?: string | null;
  /** The question is settled on the board: `optionId` is the one chosen, or null (archived). */
  resolved?: { optionId: string | null } | null;
  /** The option this device sent as the answer. */
  pickedId?: string | null;
  /** The option whose answer is on its way. */
  sendingId?: string | null;
  /** Nothing can be tapped (a card-wide busy). */
  disabled?: boolean;
}

export interface OptionTileState {
  /** Draws the recommended frame and tag: pending only. */
  recommended: boolean;
  /** The chosen one, from the board or from this device's tap. */
  picked: boolean;
  /** This tile's answer is being sent. */
  busy: boolean;
  /** No tile takes taps. */
  locked: boolean;
  /** Somebody else was chosen: draws very faint. */
  faded: boolean;
  /** Locked while another tile sends: draws a little faint. */
  dimmed: boolean;
}

export function optionTileState(input: OptionTileInput): OptionTileState {
  const { optionId, recommend, resolved, pickedId, sendingId, disabled } =
    input;
  const picked = resolved
    ? resolved.optionId === optionId
    : pickedId === optionId;
  const chosenElsewhere = resolved
    ? resolved.optionId !== null && resolved.optionId !== optionId
    : pickedId != null && pickedId !== optionId;
  const busy = !resolved && sendingId === optionId;
  const locked =
    disabled === true ||
    resolved != null ||
    pickedId != null ||
    sendingId != null;
  const pending = !resolved && pickedId == null;
  return {
    recommended: pending && recommend === optionId,
    picked,
    busy,
    locked,
    faded: chosenElsewhere,
    dimmed: locked && !picked && !busy && !chosenElsewhere,
  };
}
