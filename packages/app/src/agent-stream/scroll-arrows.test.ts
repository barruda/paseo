import { describe, expect, it } from "vitest";
import { nextScrollArrowsState, SCROLL_ARROWS_IDLE } from "./scroll-arrows";

describe("nextScrollArrowsState", () => {
  it("shows the top arrow when scrolling up away from the start", () => {
    expect(nextScrollArrowsState(SCROLL_ARROWS_IDLE, { direction: "up", atTop: false })).toEqual({
      awake: true,
      showTop: true,
    });
  });

  it("wakes only the bottom arrow when scrolling down", () => {
    expect(nextScrollArrowsState(SCROLL_ARROWS_IDLE, { direction: "down", atTop: false })).toEqual({
      awake: true,
      showTop: false,
    });
  });

  it("keeps the top arrow on a downward move, such as older history prepending", () => {
    const up = nextScrollArrowsState(SCROLL_ARROWS_IDLE, { direction: "up", atTop: false });
    expect(nextScrollArrowsState(up, { direction: "down", atTop: false })).toBe(up);
  });

  it("hides the top arrow once the start is on screen", () => {
    const up = nextScrollArrowsState(SCROLL_ARROWS_IDLE, { direction: "up", atTop: false });
    expect(nextScrollArrowsState(up, { direction: "up", atTop: true })).toEqual({
      awake: true,
      showTop: false,
    });
  });
});
