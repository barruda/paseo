import type { ReactNode } from "react";
import type { StreamLayoutItem } from "../layout";
import type { ReadingMode } from "./model";

export interface ReadingColumnsHistory {
  hasOlder: boolean;
  isLoadingOlder: boolean;
  loadOlder: () => unknown;
  /** Names how far back the loaded history reaches; it moves when an older page arrives. */
  progressKey: string | null;
}

export interface ReadingColumnsProps {
  mode: ReadingMode;
  rows: StreamLayoutItem[];
  renderRow: (layoutItem: StreamLayoutItem) => ReactNode;
  /** Pending permissions and the running turn's footer, after the last row like in the chat. */
  pendingPermissions: ReactNode;
  turnFooter: ReactNode;
  /** The daemon's older history: Columns loads all of it before it lays out pages. */
  history: ReadingColumnsHistory;
  /** Changes when the chat is sent to the bottom (a message was sent); Columns goes to the end. */
  followRequest: number;
  bottomInset: number;
}

// CUSTOM(reading-modes): Columns is a wide-screen layout; the buttons only exist in the desktop
// tab row, so native has nothing to draw.
export function ReadingColumns(_props: ReadingColumnsProps): null {
  return null;
}
