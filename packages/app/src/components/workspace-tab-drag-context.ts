import { createContext, useContext } from "react";
import type { TabDropPreview } from "./split-container-tab-drop-preview";
import type { SplitDropZoneHover } from "./split-drop-zone";
import type { LaneDropPreview } from "@/tab-lanes/geometry";
export const WorkspaceTabDragContext = createContext<{
  activeDragTabId: string | null;
  dropPreview: SplitDropZoneHover | null;
  tabDropPreview: TabDropPreview | null;
  /** CUSTOM(tab-lanes): where a tab dragged over a pane's free rows would land. */
  laneDropPreview: LaneDropPreview | null;
  externalDndContext: boolean;
}>({
  activeDragTabId: null,
  dropPreview: null,
  tabDropPreview: null,
  laneDropPreview: null,
  externalDndContext: false,
});
export function useWorkspaceTabDrag() {
  return useContext(WorkspaceTabDragContext);
}
