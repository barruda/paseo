// CUSTOM(tab-lanes): Desks are a desktop layout; native gets static chips and no drop area.
import { useMemo, type ReactElement } from "react";
import { View } from "react-native";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";

export function LaneDropArea(_props: { paneId: string; height: number }): ReactElement | null {
  return null;
}

export function LaneDraggable({
  left,
  top,
  children,
}: {
  id: string;
  data: Record<string, unknown>;
  left: number;
  top: number;
  children: (handle: DraggableListDragHandleProps | undefined, dragging: boolean) => ReactElement;
}): ReactElement {
  const style = useMemo(() => ({ position: "absolute" as const, left, top }), [left, top]);
  return <View style={style}>{children(undefined, false)}</View>;
}
