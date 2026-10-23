import type { ReactNode } from "react";
import type { AssistantMessageItem } from "@/types/stream";
import type { ReadingHistory, ReadingTurn } from "./model";

export interface ReadingOverviewProps {
  mode: "newspaper" | "cards";
  turns: ReadingTurn[];
  renderAnswer: (item: AssistantMessageItem) => ReactNode;
  onOpenTurn: (turn: ReadingTurn) => void;
  history: ReadingHistory;
  /** Changes when the chat is sent to the bottom (a message was sent); the pages go to the end. */
  followRequest: number;
  onAtEndChange: (atEnd: boolean) => void;
  /** Kept clear for the composer, which floats over the bottom of the chat. */
  bottomInset: number;
}

// CUSTOM(reading-modes): the overviews are a wide-screen layout; the buttons only exist in the
// desktop tab row, so native has nothing to draw.
export function ReadingOverview(_props: ReadingOverviewProps): null {
  return null;
}
