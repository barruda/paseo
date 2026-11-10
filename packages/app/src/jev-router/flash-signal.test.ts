import { describe, expect, it } from "vitest";
import { useJevFlashSignalStore } from "./flash-signal";

describe("jev chip flash signal", () => {
  it("keeps each chip's request until that chip shows it", () => {
    const store = useJevFlashSignalStore.getState();
    store.request("d1", { model: false, effort: true });
    expect(useJevFlashSignalStore.getState().byDraft.d1?.model).toBeUndefined();
    const effort = useJevFlashSignalStore.getState().byDraft.d1?.effort;
    expect(effort).toBeGreaterThan(0);
    store.request("d1", { model: true });
    expect(useJevFlashSignalStore.getState().byDraft.d1?.effort).toBe(effort);
    store.consume("d1", "effort");
    expect(useJevFlashSignalStore.getState().byDraft.d1).toEqual({
      model: expect.any(Number),
    });
  });
});
