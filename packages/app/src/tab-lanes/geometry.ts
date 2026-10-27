// CUSTOM(tab-lanes): vertical geometry of a pane's tab rows. One row keeps the tab bar's height.
import { buttonControlHeight } from "@/components/ui/control-geometry";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";

export const TAB_LANES_DROP_KIND = "tab-lanes";
export const LANE_CHIP_HEIGHT = buttonControlHeight.xs;
export const LANE_ROW_GAP = 4;
export const LANE_ROW_STEP = LANE_CHIP_HEIGHT + LANE_ROW_GAP;
export const LANE_PADDING_TOP = (WORKSPACE_SECONDARY_HEADER_HEIGHT - LANE_CHIP_HEIGHT) / 2;
export const LANE_PADDING_X = 4;
/** The row that shows below the last one while a tab is dragged. */
export const LANE_EXTRA_ROW_HEIGHT = LANE_CHIP_HEIGHT + LANE_ROW_GAP + 1;

export interface LaneDropPreview {
  paneId: string;
  tabId: string;
  row: number;
  x: number;
}

export function laneHeight(rowCount: number): number {
  return LANE_PADDING_TOP * 2 + rowCount * LANE_CHIP_HEIGHT + (rowCount - 1) * LANE_ROW_GAP;
}

/** Top of a chip in `row`; `rowCount` itself is the extra row below the tab bar. */
export function laneChipTop(row: number, rowCount: number): number {
  if (row < rowCount) return LANE_PADDING_TOP + row * LANE_ROW_STEP;
  return laneHeight(rowCount) + 1 + LANE_ROW_GAP / 2;
}

/** The spot under a dragged chip, from its rect and the drop area's rect (both in the viewport). */
export function laneDropSpot(
  area: { left: number; top: number },
  chip: { left: number; top: number; height: number },
): { row: number; x: number } {
  const centerY = chip.top + chip.height / 2 - area.top;
  return {
    row: Math.max(0, Math.floor((centerY - LANE_PADDING_TOP + LANE_ROW_GAP / 2) / LANE_ROW_STEP)),
    x: Math.max(0, Math.round(chip.left - area.left - LANE_PADDING_X)),
  };
}
