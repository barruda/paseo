// CUSTOM(packages): a click on a rail card is not a drag and never reassigns it.
import { expect, it } from "vitest";
import {
  PACKAGE_DRAG_THRESHOLD,
  beginPackageDrag,
  canAssignPackage,
  endPackageDrag,
  markPackageDragMoved,
  movePackageDrag,
} from "../client/package-drag";

it("a click is not a drag", () => {
  expect(endPackageDrag(beginPackageDrag("t1", 10, 10))).toBeNull();
});

it("a small move is still a click", () => {
  const state = movePackageDrag(
    beginPackageDrag("t1", 10, 10),
    10 + PACKAGE_DRAG_THRESHOLD - 1,
    10,
  );
  expect(endPackageDrag(state)).toBeNull();
});

it("a move past the threshold is a drag", () => {
  const state = movePackageDrag(
    beginPackageDrag("t1", 10, 10),
    10 + PACKAGE_DRAG_THRESHOLD,
    10,
  );
  expect(endPackageDrag(state)).toBe("t1");
});

it("entering another rail counts as a drag below the threshold", () => {
  const state = markPackageDragMoved(beginPackageDrag("t1", 10, 10));
  expect(endPackageDrag(state)).toBe("t1");
});

it("never reassigns the package the card is already in", () => {
  expect(canAssignPackage(null, "pkg")).toBe(true);
  expect(canAssignPackage("pkg", null)).toBe(true);
  expect(canAssignPackage("pkg", "other")).toBe(true);
  expect(canAssignPackage("pkg", "pkg")).toBe(false);
  expect(canAssignPackage(null, null)).toBe(false);
});
