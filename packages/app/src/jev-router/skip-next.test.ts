import { describe, expect, it } from "vitest";
import { useJevSkipNextStore } from "./skip-next";

describe("jev router skip next", () => {
  it("skips one creation on that host, then routes again", () => {
    const store = useJevSkipNextStore.getState();
    store.toggle("a");
    expect(useJevSkipNextStore.getState().consume("b")).toBe(false);
    expect(useJevSkipNextStore.getState().consume("a")).toBe(true);
    expect(useJevSkipNextStore.getState().consume("a")).toBe(false);
  });

  it("a second press cancels the skip", () => {
    const store = useJevSkipNextStore.getState();
    store.toggle("a");
    store.toggle("a");
    expect(useJevSkipNextStore.getState().consume("a")).toBe(false);
  });
});
