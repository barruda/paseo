import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Text } from "react-native";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { TurnTiming } from "@/timeline/turn-time";
import type { StreamItem } from "@/types/stream";
import { createNativeStreamStrategy } from "./strategy-native";
import { CompletedTurnFooterRow } from "./turn-footer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// A Sunday, so a turn that ended on Friday shows a weekday timestamp.
const NOW = new Date(2026, 10, 8, 5, 0);
const FRIDAY_NIGHT = new Date(2026, 10, 6, 23, 11);

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  host = document.createElement("div");
  host.style.width = "880px";
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  await i18n.changeLanguage("en");
  vi.unstubAllGlobals();
});

const reply: StreamItem = {
  kind: "assistant_message",
  id: "reply",
  text: "Done.",
  timestamp: FRIDAY_NIGHT,
};

function renderCompletedFooter(timing: TurnTiming, withUsage = false): void {
  act(() =>
    root.render(
      <CompletedTurnFooterRow
        strategy={createNativeStreamStrategy()}
        items={withUsage ? [reply, usage] : [reply]}
        timing={timing}
        startIndex={0}
        supportsTimelineCursor={false}
        renderTurnUsage={withUsage ? renderUsage : undefined}
      />,
    ),
  );
}

// CUSTOM(turn-footer-wrap): the token-ledger usage row the footer draws after its timing.
const usage: StreamItem = {
  kind: "plugin",
  id: "usage",
  timestamp: FRIDAY_NIGHT,
  pluginId: "token-ledger",
  pluginItemId: "usage",
  itemKind: "turn-usage",
  version: 1,
  data: {},
};
const USAGE_TEXT =
  "claude-opus-5-5 / high · in 16 · cache 517.1k · write 4.9k · out 2.0k · 79 tok/s · $0.32 · 45s";
const renderUsage = () => <Text>{USAGE_TEXT}</Text>;

/** How many painted lines each footer label takes. */
function paintedLinesByLabel(element: HTMLElement): Record<string, number> {
  const lines: Record<string, number> = {};
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent ?? "";
    if (!text.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(walker.currentNode);
    lines[text] = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
  }
  return lines;
}

// The footer shows the duration and swaps to the end timestamp on hover or tap. Neither label
// may be sized by the other: a timestamp with more characters can still paint narrower.
it.each([
  {
    language: "en",
    timing: { completedAt: FRIDAY_NIGHT, durationMs: 26_000 },
    duration: "Worked for 26s",
  },
  // CJK glyphs make the shorter string paint wider in every font.
  {
    language: "ja",
    timing: { completedAt: FRIDAY_NIGHT, durationMs: 59 * 60_000 + 58_000 },
    duration: "作業時間 59m 58s",
  },
])("keeps both timing labels on one line when the chat has room ($language)", async (input) => {
  await i18n.changeLanguage(input.language);

  renderCompletedFooter(input.timing);

  expect(paintedLinesByLabel(host)).toEqual({
    [input.duration]: 1,
    "Friday 11:11 PM": 1,
  });
});

// CUSTOM(turn-footer-wrap): a long usage row used to squeeze "Worked for" to one letter per line.
it.each([240, 360, 880])(
  "keeps the timing on one line and wraps the usage row in the room left (%ipx)",
  (width) => {
    host.style.width = `${width}px`;
    renderCompletedFooter({ completedAt: FRIDAY_NIGHT, durationMs: 25_000 }, true);

    const lines = paintedLinesByLabel(host);
    expect(lines["Worked for 25s"]).toBe(1);
    expect(lines["Friday 11:11 PM"]).toBe(1);
    const usageNode = Array.from(host.querySelectorAll("div")).find(
      (element) => element.textContent === USAGE_TEXT && element.children.length === 0,
    )!;
    const usageBounds = usageNode.getBoundingClientRect();
    const hostBounds = host.getBoundingClientRect();
    const timingBounds = host
      .querySelector('[data-testid="turn-footer-timing-label"]')!
      .getBoundingClientRect();
    expect(usageBounds.left).toBeGreaterThanOrEqual(timingBounds.right);
    expect(usageBounds.right).toBeLessThanOrEqual(hostBounds.right + 0.5);
    if (width < 880) {
      expect(lines[USAGE_TEXT]).toBeGreaterThan(1);
    }
  },
);
