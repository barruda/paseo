// CUSTOM(tab-lanes): lane chips drag with the split container's DndContext, like the sortable row,
// and the rows are one drop area that reaches one row below the tab bar.
import { useMemo, type ReactElement } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import { TAB_LANES_DROP_KIND } from "./geometry";

export function LaneDropArea({ paneId, height }: { paneId: string; height: number }) {
  const data = useMemo(() => ({ kind: TAB_LANES_DROP_KIND, paneId }), [paneId]);
  const { setNodeRef } = useDroppable({ id: `tab-lanes:${paneId}`, data });
  const style = useMemo(
    () => ({
      position: "absolute" as const,
      left: 0,
      right: 0,
      top: 0,
      height,
      pointerEvents: "none" as const,
    }),
    [height],
  );
  return <div ref={setNodeRef} style={style} />;
}

export function LaneDraggable({
  id,
  data,
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
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id,
    data,
  });
  const handle = useMemo<DraggableListDragHandleProps>(
    () => ({
      attributes: attributes as unknown as Record<string, unknown>,
      listeners: listeners as unknown as Record<string, unknown>,
      setActivatorNodeRef: setActivatorNodeRef as unknown as (node: unknown) => void,
    }),
    [attributes, listeners, setActivatorNodeRef],
  );
  const style = useMemo(
    () => ({ position: "absolute" as const, left, top, opacity: isDragging ? 0.3 : 1, zIndex: 1 }),
    [isDragging, left, top],
  );
  return (
    <div ref={setNodeRef} style={style}>
      {children(handle, isDragging)}
    </div>
  );
}
