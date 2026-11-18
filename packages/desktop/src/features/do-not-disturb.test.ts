import { describe, expect, it, vi } from "vitest";
import type { DoNotDisturbState } from "@getpaseo/protocol/do-not-disturb";

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("electron-log/main", () => ({ default: { warn: vi.fn() } }));

import { createDoNotDisturbController } from "./do-not-disturb.js";

const NOW = new Date(2026, 10, 18, 14, 30, 0);

function setup(initial: DoNotDisturbState = { enabled: false, until: null }) {
  let stored = initial;
  const broadcast = vi.fn();
  let now = NOW;
  const controller = createDoNotDisturbController({
    paseoHome: "/home/test/.paseo",
    now: () => now,
    read: async () => stored,
    write: async (_home, state) => {
      stored = state;
    },
    broadcast,
  });
  return {
    controller,
    broadcast,
    stored: () => stored,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe("do-not-disturb controller (CUSTOM do-not-disturb)", () => {
  it("lets notifications through while off", async () => {
    const { controller } = setup();
    expect(await controller.isActive()).toBe(false);
  });

  it("blocks notifications once on, and lets them through again once off", async () => {
    const { controller, broadcast, stored } = setup();
    await controller.set({ action: "on" });
    expect(stored()).toEqual({ enabled: true, until: null });
    expect(await controller.isActive()).toBe(true);
    expect(broadcast).toHaveBeenLastCalledWith({ enabled: true, until: null });

    await controller.set({ action: "off" });
    expect(await controller.isActive()).toBe(false);
    expect(broadcast).toHaveBeenLastCalledWith({ enabled: false, until: null });
  });

  it("toggles", async () => {
    const { controller } = setup();
    expect(await controller.set({ action: "toggle" })).toEqual({ enabled: true, until: null });
    expect(await controller.set({ action: "toggle" })).toEqual({ enabled: false, until: null });
  });

  it("turns itself off when the duration ends", async () => {
    const { controller, advance } = setup();
    await controller.set({ action: "on", duration: "1h" });
    expect(await controller.isActive()).toBe(true);
    advance(60 * 60_000);
    expect(await controller.isActive()).toBe(false);
    expect(await controller.get()).toEqual({ enabled: false, until: null });
  });

  it("rejects an unknown action", async () => {
    const { controller } = setup();
    await expect(controller.set({ action: "maybe" })).rejects.toThrow(/action/);
  });
});
