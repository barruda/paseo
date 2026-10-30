// CUSTOM(reading-modes): the chat rows Columns and Compact lay out as pages. They cover the whole
// conversation, not the chat's mounted window, so page 1 is the first message.
import { useMemo } from "react";
import { isWeb } from "@/constants/platform";
import type { StreamItem } from "@/types/stream";
import { layoutStream, type StreamLayoutItem } from "../layout";
import { type AgentStreamRenderModel, buildAgentStreamRenderModel } from "../model";
import type { StreamStrategy } from "../strategy";
import { type ReadingMode, selectCompactRows } from "./model";

const NO_ROWS: StreamLayoutItem[] = [];

export function useReadingRows(input: {
  mode: ReadingMode;
  /** The chat's render model, reused when its window already starts at the first message. */
  chatRenderModel: AgentStreamRenderModel;
  chatHistoryStart: number;
  tail: StreamItem[];
  head: StreamItem[];
  isTurnActive: boolean;
  activeTurnStartedAt: Date | null;
  isMobileBreakpoint: boolean;
  strategy: StreamStrategy;
}): StreamLayoutItem[] {
  const {
    mode,
    chatRenderModel,
    chatHistoryStart,
    tail,
    head,
    isTurnActive,
    activeTurnStartedAt,
    isMobileBreakpoint,
    strategy,
  } = input;
  return useMemo(() => {
    if (mode !== "columns" && mode !== "compact") return NO_ROWS;
    const whole =
      chatHistoryStart === 0
        ? chatRenderModel
        : buildAgentStreamRenderModel({
            isTurnActive,
            activeTurnStartedAt,
            tail,
            head,
            platform: isWeb ? "web" : "native",
            isMobileBreakpoint,
            historyStart: 0,
          });
    const layout = layoutStream({
      strategy,
      isTurnActive,
      history: whole.history,
      liveHead: whole.segments.liveHead,
      timingByItemId: whole.turnTiming.byItemId,
    });
    const rows = [...layout.history, ...layout.liveHead];
    return mode === "compact" ? selectCompactRows(rows, [...tail, ...head]) : rows;
  }, [
    activeTurnStartedAt,
    chatHistoryStart,
    chatRenderModel,
    head,
    isMobileBreakpoint,
    isTurnActive,
    mode,
    strategy,
    tail,
  ]);
}
