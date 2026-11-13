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

function startStorm(at = 1200) {
  subscribeJevEscRestart(() => true);
  recordKeyboardInterrupt("s", "a", 1000);
  expect(noteKeydownAfterInterrupt(esc, at)).toBe(true);
}

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

  it("storm: swallows the Escape that restarts and every later one, each extending the window", () => {
    startStorm(1200);
    expect(noteKeydownAfterInterrupt(esc, 2500)).toBe(true);
    expect(noteKeydownAfterInterrupt(esc, 4400)).toBe(true);
    expect(noteKeydownAfterInterrupt({ ...esc, repeat: true, shiftKey: true }, 6000)).toBe(true);
  });

  it("storm: lets other keys through without extending or ending the window", () => {
    startStorm(1200);
    expect(noteKeydownAfterInterrupt({ key: "x" }, 2000)).toBe(false);
    expect(noteKeydownAfterInterrupt(esc, 3000)).toBe(true);
    expect(noteKeydownAfterInterrupt({ key: "x" }, 4000)).toBe(false);
    expect(noteKeydownAfterInterrupt(esc, 5000)).toBe(true);
    expect(noteKeydownAfterInterrupt(esc, 7001)).toBe(false);
  });

  it("storm: ends 2 s after the last Escape and then behaves normally", () => {
    startStorm(1200);
    expect(noteKeydownAfterInterrupt(esc, 3200)).toBe(true);
    expect(noteKeydownAfterInterrupt(esc, 5201)).toBe(false);
    expect(noteKeydownAfterInterrupt(esc, 5300)).toBe(false);
  });

  it("storm: can start a new storm after the quiet gap", () => {
    const listener = vi.fn(() => true);
    subscribeJevEscRestart(listener);
    recordKeyboardInterrupt("s", "a", 1000);
    noteKeydownAfterInterrupt(esc, 1200);
    recordKeyboardInterrupt("s", "a", 9000);
    expect(noteKeydownAfterInterrupt(esc, 9200)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("storm: does not swallow when no listener started a restart", () => {
    subscribeJevEscRestart(() => false);
    recordKeyboardInterrupt("s", "a", 1000);
    expect(noteKeydownAfterInterrupt(esc, 1200)).toBe(false);
    expect(noteKeydownAfterInterrupt(esc, 1300)).toBe(false);
  });
});
