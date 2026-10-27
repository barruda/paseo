// CUSTOM(tab-lanes): a pane's tabs in free rows. One row until a tab is dropped below it; while a
// tab is dragged, an extra row shows under the tab bar to drop it in.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import { dropOnLanes, layoutLanes, type LanePositions } from "./model";
import { laneTabWidth, setLanePaneMetrics, useTabLanesStore } from "./store";
import { LaneDraggable, LaneDropArea } from "./dnd";
import {
  LANE_CHIP_HEIGHT,
  LANE_EXTRA_ROW_HEIGHT,
  LANE_PADDING_TOP,
  LANE_PADDING_X,
  LANE_ROW_GAP,
  laneChipTop,
  laneHeight,
  type LaneDropPreview,
} from "./geometry";

export interface LaneEntry {
  tabId: string;
  /** The DnD id, unique in the split container. */
  dragId: string;
  dragData: Record<string, unknown>;
  /** Chip width plus its slot margins. */
  width: number;
  render: (handle: DraggableListDragHandleProps | undefined, dragging: boolean) => ReactElement;
}

const NO_POSITIONS: LanePositions = {};
// Room kept after the rightmost tab of the first row for the inline new tab button.
const NEW_TAB_RESERVED_WIDTH = 36;

export function TabLanes({
  scope,
  paneId,
  entries,
  dragging,
  drop,
  newTabButton,
}: {
  scope: string;
  paneId: string;
  entries: LaneEntry[];
  /** A tab is being dragged anywhere in the split container. */
  dragging: boolean;
  /** Where the dragged tab would land in this pane, if it's over this pane's rows. */
  drop: LaneDropPreview | null;
  newTabButton: ReactNode;
}) {
  const [areaWidth, setAreaWidth] = useState(0);
  const stored = useTabLanesStore((state) => state.byScope[scope] ?? NO_POSITIONS);
  const roomWidth = Math.max(0, areaWidth - LANE_PADDING_X * 2 - NEW_TAB_RESERVED_WIDTH);
  const laneTabs = useMemo(
    () => entries.map((entry) => ({ id: entry.tabId, width: entry.width })),
    [entries],
  );
  const layout = useMemo(
    () =>
      roomWidth > 0
        ? layoutLanes({ tabs: laneTabs, positions: stored, width: roomWidth, gap: 0 })
        : null,
    [laneTabs, roomWidth, stored],
  );

  // A tab without a spot gets the one it was just given, so closing a neighbor leaves a gap.
  useEffect(() => {
    if (!layout || laneTabs.every((tab) => stored[tab.id])) return;
    useTabLanesStore.getState().setPositions(scope, layout.positions);
  }, [layout, laneTabs, scope, stored]);

  useEffect(() => {
    if (roomWidth > 0)
      setLanePaneMetrics(scope, paneId, { tabs: laneTabs, width: roomWidth, gap: 0 });
  }, [laneTabs, paneId, roomWidth, scope]);
  useEffect(() => () => setLanePaneMetrics(scope, paneId, null), [paneId, scope]);

  const preview = useMemo(() => {
    if (!drop || !layout) return null;
    return dropOnLanes({
      tabs: laneTabs,
      positions: layout.positions,
      width: roomWidth,
      gap: 0,
      tabId: drop.tabId,
      tabWidth: laneTabWidth(scope, drop.tabId) ?? 120,
      row: drop.row,
      x: drop.x,
    });
  }, [drop, laneTabs, layout, roomWidth, scope]);

  const rowCount = layout?.rowCount ?? 1;
  const shown = preview?.positions ?? layout?.positions ?? NO_POSITIONS;
  const foreignDrop =
    drop && preview && !laneTabs.some((tab) => tab.id === drop.tabId)
      ? {
          spot: preview.positions[drop.tabId],
          width: laneTabWidth(scope, drop.tabId) ?? 120,
        }
      : null;
  const newTabLeft = useMemo(() => {
    const ends = laneTabs.flatMap((tab) => {
      const spot = layout?.positions[tab.id];
      return spot && spot.row === 0 ? [spot.x + tab.width] : [];
    });
    return LANE_PADDING_X + Math.max(0, ...ends);
  }, [laneTabs, layout]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    setAreaWidth((current) => (current === width ? current : width));
  }, []);

  return (
    <View
      style={[styles.lanes, { height: laneHeight(rowCount) }]}
      onLayout={handleLayout}
      testID="tab-lanes"
    >
      <LaneDropArea paneId={paneId} height={laneHeight(rowCount) + LANE_EXTRA_ROW_HEIGHT} />
      {dragging ? (
        <View
          style={[styles.extraRow, { top: laneHeight(rowCount) + 1 }]}
          pointerEvents="none"
          testID="tab-lanes-extra-row"
        >
          <View style={styles.extraRowSlot} />
        </View>
      ) : null}
      {layout
        ? entries.map((entry) => {
            const spot = shown[entry.tabId];
            if (!spot) return null;
            return (
              <LaneDraggable
                key={entry.dragId}
                id={entry.dragId}
                data={entry.dragData}
                left={LANE_PADDING_X + spot.x}
                top={laneChipTop(spot.row, rowCount)}
              >
                {entry.render}
              </LaneDraggable>
            );
          })
        : null}
      {foreignDrop?.spot ? (
        <View
          pointerEvents="none"
          style={[
            styles.ghost,
            {
              left: LANE_PADDING_X + foreignDrop.spot.x,
              top: laneChipTop(foreignDrop.spot.row, rowCount),
              width: foreignDrop.width - LANE_ROW_GAP,
            },
          ]}
        />
      ) : null}
      {layout ? (
        <View style={[styles.newTab, { left: newTabLeft, top: LANE_PADDING_TOP }]}>
          {newTabButton}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  lanes: {
    flex: 1,
    minWidth: 0,
    position: "relative",
    overflow: "visible",
  },
  extraRow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: LANE_EXTRA_ROW_HEIGHT,
    paddingHorizontal: LANE_PADDING_X,
    paddingVertical: LANE_ROW_GAP / 2,
    backgroundColor: theme.colors.surface0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  extraRowSlot: {
    flex: 1,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.surface3,
  },
  ghost: {
    position: "absolute",
    height: LANE_CHIP_HEIGHT,
    marginLeft: LANE_ROW_GAP / 2,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.foregroundMuted,
    zIndex: 2,
  },
  newTab: {
    position: "absolute",
    height: LANE_CHIP_HEIGHT,
    justifyContent: "center",
  },
}));
