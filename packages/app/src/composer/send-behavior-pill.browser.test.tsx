// CUSTOM(send-behavior-pill)
import React, { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { SendBehavior } from "@/hooks/use-settings";
import { SendBehaviorPill } from "./send-behavior-pill";

// Importing the instance initializes i18next with the English resources.
void i18n;

// The real settings hook pulls in native-only modules; this store stands in for the app setting.
const settingsStore = vi.hoisted(() => {
  let sendBehavior: SendBehavior = "steer";
  const listeners = new Set<() => void>();
  return {
    get: () => sendBehavior,
    set: (next: SendBehavior) => {
      sendBehavior = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => {
    const sendBehavior = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
    return {
      settings: { sendBehavior },
      updateSettings: async (updates: { sendBehavior?: SendBehavior }) => {
        if (updates.sendBehavior) settingsStore.set(updates.sendBehavior);
      },
    };
  },
}));

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => {
  vi.stubGlobal("React", React);
  settingsStore.set("steer");
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mountPill(): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<SendBehaviorPill />));
}

function pill(): HTMLElement {
  const trigger = document.querySelector('[data-testid="composer-send-behavior-pill"]');
  if (!(trigger instanceof HTMLElement)) throw new Error("send behavior pill did not render");
  return trigger;
}

function click(element: Element): void {
  act(() => {
    (element as HTMLElement).click();
  });
}

describe("send behavior pill", () => {
  it("shows the current send behavior and saves the one picked from its menu", async () => {
    mountPill();
    expect(pill().textContent).toBe("Steer");

    click(pill());
    const queue = await vi.waitFor(() => {
      const item = document.querySelector('[data-testid="composer-send-behavior-queue"]');
      if (!item) throw new Error("menu did not open");
      return item;
    });
    expect(document.querySelectorAll('[data-testid^="composer-send-behavior-"]')).toHaveLength(4);
    click(queue);

    await vi.waitFor(() => expect(pill().textContent).toBe("Queue"));
    expect(settingsStore.get()).toBe("queue");
  });
});
