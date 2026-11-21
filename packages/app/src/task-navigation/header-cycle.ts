// CUSTOM(header-cycle): Shift+Tab in Tasks mode steps through the Desk header in the order it
// shows its items: the plugin surface chips (Workboard), the Desk chips, then the Project Manager
// button, and back to the start.

export type HeaderCycleItem =
  | { kind: "surface"; id: string }
  | { kind: "desk"; id: string }
  | { kind: "project-manager" };

/** The header items, in header order. Closed surfaces and a hidden Project Manager are left out. */
export function headerCycleItems(input: {
  surfaceIds: readonly string[];
  deskIds: readonly string[];
  projectManager: boolean;
}): HeaderCycleItem[] {
  return [
    ...input.surfaceIds.map((id): HeaderCycleItem => ({ kind: "surface", id })),
    ...input.deskIds.map((id): HeaderCycleItem => ({ kind: "desk", id })),
    ...(input.projectManager ? [{ kind: "project-manager" } as const] : []),
  ];
}

/**
 * Where the cycle stands: the selected surface chip, else the Project Manager (its sidebar tab has
 * the keyboard focus, or its Desk is active), else the active Desk. -1 when none is in the cycle.
 */
export function currentHeaderCycleIndex(
  items: readonly HeaderCycleItem[],
  position: {
    selectedSurfaceId: string | null;
    projectManagerCurrent: boolean;
    activeDeskId: string;
  },
): number {
  const surface = items.findIndex(
    (item) => item.kind === "surface" && item.id === position.selectedSurfaceId,
  );
  if (surface >= 0) return surface;
  if (position.projectManagerCurrent) {
    const projectManager = items.findIndex((item) => item.kind === "project-manager");
    if (projectManager >= 0) return projectManager;
  }
  return items.findIndex((item) => item.kind === "desk" && item.id === position.activeDeskId);
}

/** The item after the current one, wrapping around; the first item when none is current. */
export function nextHeaderCycleItem(
  items: readonly HeaderCycleItem[],
  position: Parameters<typeof currentHeaderCycleIndex>[1],
): HeaderCycleItem | null {
  if (items.length === 0) return null;
  const index = currentHeaderCycleIndex(items, position);
  return items[(index + 1) % items.length] ?? null;
}
