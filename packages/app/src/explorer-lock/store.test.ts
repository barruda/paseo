// CUSTOM(explorer-lock)
import { describe, expect, it } from "vitest";
import { useExplorerLockStore } from "./store";

describe("useExplorerLockStore width", () => {
  it("starts unknown and ignores invalid widths", () => {
    expect(useExplorerLockStore.getState().width).toBeNull();
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      useExplorerLockStore.getState().setWidth(bad);
      expect(useExplorerLockStore.getState().width).toBeNull();
    }
    useExplorerLockStore.getState().setWidth(400);
    expect(useExplorerLockStore.getState().width).toBe(400);
  });
});
