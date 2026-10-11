import { describe, expect, it } from "vitest";
import {
  countFittingShortcuts,
  estimateShortcutWidth,
  STRIP_MARGIN_PX,
  TITLE_RESERVE_PX,
} from "./fit";

describe("countFittingShortcuts", () => {
  const fixed = TITLE_RESERVE_PX + STRIP_MARGIN_PX;

  it("shows the shortcuts that fit after the title reserve and the buttons, in order", () => {
    const itemWidths = [100, 100, 100];
    expect(
      countFittingShortcuts({ headerWidth: fixed + 300 + 212, buttonsWidth: 300, itemWidths }),
    ).toBe(2);
    expect(
      countFittingShortcuts({ headerWidth: fixed + 300 + 324, buttonsWidth: 300, itemWidths }),
    ).toBe(3);
  });

  it("shows none when the header is too narrow", () => {
    expect(
      countFittingShortcuts({
        headerWidth: fixed + 300 + 50,
        buttonsWidth: 300,
        itemWidths: [100],
      }),
    ).toBe(0);
  });
});

describe("estimateShortcutWidth", () => {
  it("grows with the keys and the label", () => {
    expect(estimateShortcutWidth("Ctrl+M", "Model")).toBeLessThan(
      estimateShortcutWidth("Shift+Tab", "Next active"),
    );
  });
});
