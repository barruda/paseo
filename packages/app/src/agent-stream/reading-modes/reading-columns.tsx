import type { ReactNode } from "react";
import type { StreamLayoutItem } from "../layout";
import type { ReadingHistory, ReadingMode } from "./model";

export interface ReadingColumnsProps {
  mode: ReadingMode;
  /** The whole conversation's chat rows; Compact keeps prompts and final answers. */
  rows: StreamLayoutItem[];
  renderRow: (layoutItem: StreamLayoutItem) => ReactNode;
  /** Pending permissions and the running turn's footer, after the last row like in the chat. */
  pendingPermissions: ReactNode;
  turnFooter: ReactNode;
  history: ReadingHistory;
  /** Changes when the chat is sent to the bottom (a message was sent); the pages go to the end. */
  followRequest: number;
  onAtEndChange: (atEnd: boolean) => void;
  bottomInset: number;
}

// CUSTOM(reading-modes): Columns and Compact are a wide-screen layout; the buttons only exist in
// the desktop tab row, so native has nothing to draw.
export function ReadingColumns(_props: ReadingColumnsProps): null {
  return null;
}
