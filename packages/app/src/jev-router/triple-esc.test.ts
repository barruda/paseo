import { afterEach, describe, expect, it, vi } from "vitest";
import {
  noteKeydownAfterInterrupt,
  recordKeyboardInterrupt,
  resetKeyboardInterruptForTest,
  shouldRestartOnEscape,
  subscribeJevEscRestart,
} from "./triple-esc";

const interrupt = { serverId: "s", agentId: "a", at: 1000 };
const esc = { key: "Escape" };

describe("jev esc 3x", () => {
  afterEach(resetKeyboardInterruptForTest);

  it("restarts on a plain Escape within the chord timeout", () => {
    expect(shouldRestartOnEscape(interrupt, 1000, esc)).toBe(true);
    expect(shouldRestartOnEscape(interrupt, 2500, esc)).toBe(true);
    expect(shouldRestartOnEscape(interrupt, 2501, esc)).toBe(false);
  });

  it("ignores modifiers, repeats, composition, other keys and no interrupt", () => {
    expect(shouldRestartOnEscape(null, 1000, esc)).toBe(false);
    expect(shouldRestartOnEscape(interrupt, 1000, { ...esc, shiftKey: true })).toBe(false);
    expect(shouldRestartOnEscape(interrupt, 1000, { ...esc, ctrlKey: true })).toBe(false);
    expect(shouldRestartOnEscape(interrupt, 1000, { ...esc, repeat: true })).toBe(false);
    expect(shouldRestartOnEscape(interrupt, 1000, { ...esc, isComposing: true })).toBe(false);
    expect(shouldRestartOnEscape(interrupt, 1000, { key: "Enter" })).toBe(false);
  });

  it("emits once per interrupt", () => {
    const listener = vi.fn();
    subscribeJevEscRestart(listener);
    recordKeyboardInterrupt("s", "a", 1000);
    noteKeydownAfterInterrupt(esc, 1200);
    noteKeydownAfterInterrupt(esc, 1400);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ serverId: "s", agentId: "a" });
  });

  it("a typed key between them ends the window, a bare modifier does not", () => {
    const listener = vi.fn();
    subscribeJevEscRestart(listener);
    recordKeyboardInterrupt("s", "a", 1000);
    noteKeydownAfterInterrupt({ key: "Shift" }, 1100);
    noteKeydownAfterInterrupt({ key: "x" }, 1200);
    noteKeydownAfterInterrupt(esc, 1300);
    expect(listener).not.toHaveBeenCalled();
  });
});
