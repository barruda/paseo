import { afterEach, describe, expect, it } from "vitest";
import { useBoardAgentsStore } from "./store";

describe("useBoardAgentsStore", () => {
  afterEach(() => useBoardAgentsStore.getState().setShowBoardAgents(false));

  it("hides board agents by default", () => {
    expect(useBoardAgentsStore.getState().showBoardAgents).toBe(false);
  });

  it("toggles", () => {
    useBoardAgentsStore.getState().setShowBoardAgents(true);
    expect(useBoardAgentsStore.getState().showBoardAgents).toBe(true);
  });
});
