import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
}));

const { nextJevBypassMode, useJevBypassStore } = await import("./bypass");

describe("jev router bypass", () => {
  it("cycles off → once → always → off", () => {
    expect(nextJevBypassMode("off")).toBe("once");
    expect(nextJevBypassMode("once")).toBe("always");
    expect(nextJevBypassMode("always")).toBe("off");
  });

  it("uses up a once bypass and keeps an always bypass", () => {
    const store = useJevBypassStore.getState();
    store.setMode("once");
    expect(useJevBypassStore.getState().consume()).toBe(true);
    expect(useJevBypassStore.getState().mode).toBe("off");
    expect(useJevBypassStore.getState().consume()).toBe(false);
    store.setMode("always");
    expect(useJevBypassStore.getState().consume()).toBe(true);
    expect(useJevBypassStore.getState().mode).toBe("always");
  });
});
