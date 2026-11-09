import { describe, expect, it, vi } from "vitest";

vi.mock("./desks-store", () => ({ useDesksStore: { getState: () => ({}) } }));

import { rememberClosed, reopenKeyAction, type ClosedTabsState } from "./reopen-closed-tab";

const empty: ClosedTabsState = { stack: [], armed: false };
const agentTab = (agentId: string) => ({
  deskId: "desk-1",
  input: { serverId: "s", workspaceId: "w", target: { kind: "agent" as const, agentId } },
});
const key = (k: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) => ({
  key: k,
  ctrlKey: mods.ctrl ?? false,
  metaKey: false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
});

describe("reopen closed tab", () => {
  it("arms on close and reopens with Ctrl+Z", () => {
    const state = rememberClosed(empty, [agentTab("a")]);
    expect(state.armed).toBe(true);
    expect(reopenKeyAction(state, key("z", { ctrl: true }))).toBe("reopen");
    expect(reopenKeyAction(state, key("Z", { ctrl: true }))).toBe("reopen");
  });

  it("any other key disarms, so Ctrl+Z goes back to undoing text", () => {
    const state = rememberClosed(empty, [agentTab("a")]);
    expect(reopenKeyAction(state, key("a"))).toBe("disarm");
    const disarmed = { ...state, armed: false };
    expect(reopenKeyAction(disarmed, key("z", { ctrl: true }))).toBe("ignore");
  });

  it("modifier presses and Ctrl+Shift+Z leave it armed or disarm as expected", () => {
    const state = rememberClosed(empty, [agentTab("a")]);
    expect(reopenKeyAction(state, key("Control", { ctrl: true }))).toBe("ignore");
    expect(reopenKeyAction(state, key("z", { ctrl: true, shift: true }))).toBe("disarm");
  });

  it("does not remember empty launcher tabs and keeps the newest twenty", () => {
    const launcher = {
      deskId: "desk-1",
      input: { serverId: "s", workspaceId: "w", target: { kind: "new_tab" as const } },
    };
    expect(rememberClosed(empty, [launcher])).toBe(empty);
    let state = empty;
    for (let i = 0; i < 25; i++) state = rememberClosed(state, [agentTab(String(i))]);
    expect(state.stack).toHaveLength(20);
    expect(state.stack.at(-1)?.input.target).toEqual({ kind: "agent", agentId: "24" });
  });

  it("does nothing when the stack is empty", () => {
    expect(reopenKeyAction({ stack: [], armed: true }, key("z", { ctrl: true }))).toBe("disarm");
  });
});
