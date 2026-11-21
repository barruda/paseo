import { describe, expect, it } from "vitest";
import { optionTileState } from "../shared/option-tiles";

describe("optionTileState", () => {
  it("marks only the recommended tile while pending", () => {
    expect(optionTileState({ optionId: "a", recommend: "a" }).recommended).toBe(
      true,
    );
    expect(optionTileState({ optionId: "b", recommend: "a" }).recommended).toBe(
      false,
    );
    expect(optionTileState({ optionId: "a", recommend: "a" }).locked).toBe(
      false,
    );
  });

  it("shows the chosen tile and fades the others on a decided card", () => {
    const resolved = { optionId: "b" };
    const chosen = optionTileState({ optionId: "b", recommend: "a", resolved });
    const other = optionTileState({ optionId: "a", recommend: "a", resolved });
    expect(chosen).toMatchObject({
      picked: true,
      faded: false,
      locked: true,
      recommended: false,
    });
    expect(other).toMatchObject({
      picked: false,
      faded: true,
      locked: true,
      recommended: false,
    });
  });

  it("draws an archived card neutral: nothing picked, nothing faded, no taps", () => {
    const state = optionTileState({
      optionId: "a",
      recommend: "a",
      resolved: { optionId: null },
    });
    expect(state).toMatchObject({
      picked: false,
      faded: false,
      locked: true,
      recommended: false,
    });
  });

  it("marks the sending tile busy and dims the rest", () => {
    const busy = optionTileState({ optionId: "a", sendingId: "a" });
    const rest = optionTileState({ optionId: "b", sendingId: "a" });
    expect(busy).toMatchObject({ busy: true, locked: true, dimmed: false });
    expect(rest).toMatchObject({ busy: false, locked: true, dimmed: true });
  });

  it("keeps the picked tile on this device and fades the others", () => {
    expect(optionTileState({ optionId: "a", pickedId: "a" })).toMatchObject({
      picked: true,
      faded: false,
    });
    expect(optionTileState({ optionId: "b", pickedId: "a" })).toMatchObject({
      picked: false,
      faded: true,
      dimmed: false,
    });
  });

  it("locks every tile when disabled", () => {
    expect(optionTileState({ optionId: "a", disabled: true })).toMatchObject({
      locked: true,
      dimmed: true,
    });
  });
});
