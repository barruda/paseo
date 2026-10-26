import { describe, expect, it } from "vitest";
import { boostContentMaxWidth } from "./store";

describe("boostContentMaxWidth", () => {
  it("keeps the configured width when the window is not maximized", () => {
    expect(boostContentMaxWidth(820, { stepIndex: 2, windowMaximized: false })).toBe(820);
  });

  it("scales by the current step when maximized", () => {
    expect(boostContentMaxWidth(820, { stepIndex: 0, windowMaximized: true })).toBe(820);
    expect(boostContentMaxWidth(820, { stepIndex: 1, windowMaximized: true })).toBe(1230);
    expect(boostContentMaxWidth(820, { stepIndex: 2, windowMaximized: true })).toBe(1640);
  });

  it("removes the cap at the full step", () => {
    expect(boostContentMaxWidth(820, { stepIndex: 3, windowMaximized: true })).toBeGreaterThan(
      10_000,
    );
  });
});
