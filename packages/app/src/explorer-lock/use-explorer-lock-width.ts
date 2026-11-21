// CUSTOM(explorer-lock): with the lock on, every Explorer frame uses one saved width (shared by
// Tasks mode and the workspace view) and resizing updates it; the per-workspace width stays
// untouched, so unlocking brings back each content's own width.
import { useCallback, useEffect } from "react";
import { resolveExplorerLockWidth, shouldSeedLockedWidth, type ExplorerLockMode } from "./model";
import { useExplorerLockSetting } from "./settings";
import { useExplorerLockHydrated, useExplorerLockStore } from "./store";

export function useExplorerLockWidth(input: {
  mode: ExplorerLockMode;
  overlay: boolean;
  active: boolean;
  ownWidth: number | undefined;
  resizeOwn: (width: number) => void;
}): { requestedWidth: number | undefined; onResize: (width: number) => void } {
  const { mode, overlay, active, ownWidth, resizeOwn } = input;
  const setting = useExplorerLockSetting(mode);
  const hydrated = useExplorerLockHydrated();
  const lockedWidth = useExplorerLockStore((state) => state.width);
  const { locked, width } = resolveExplorerLockWidth({
    lockOn: setting.lockOn,
    hydrated,
    compact: overlay,
    lockedWidth,
    ownWidth,
  });
  const seed = shouldSeedLockedWidth({ locked, active, lockedWidth, ownWidth });
  useEffect(() => {
    if (seed && ownWidth !== undefined) useExplorerLockStore.getState().setWidth(ownWidth);
  }, [seed, ownWidth]);
  const onResize = useCallback(
    (next: number) => {
      if (locked) useExplorerLockStore.getState().setWidth(next);
      else resizeOwn(next);
    },
    [locked, resizeOwn],
  );
  return { requestedWidth: width, onResize };
}
