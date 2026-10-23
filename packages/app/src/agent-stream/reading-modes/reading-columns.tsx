import type { ReactNode } from "react";
import type { StreamLayoutItem } from "../layout";
import type { ReadingMode } from "./model";

export interface ReadingColumnsProps {
  mode: ReadingMode;
  rows: StreamLayoutItem[];
  renderRow: (layoutItem: StreamLayoutItem) => ReactNode;
  /** Pending permissions and the running turn's footer, after the last row like in the chat. */
  pendingPermissions: ReactNode;
  turnFooter: ReactNode;
  history: { hasOlder: boolean; isLoadingOlder: boolean; loadOlder: () => unknown };
  bottomInset: number;
}

// CUSTOM(reading-modes): Columns is a wide-screen layout; the buttons only exist in the desktop
// tab row, so native has nothing to draw.
export function ReadingColumns(_props: ReadingColumnsProps): null {
  return null;
}
