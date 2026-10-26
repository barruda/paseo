// CUSTOM(commit-selection): the Changes tree's checked files for one checkout.
import { useCallback, useEffect, useMemo } from "react";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import { useSessionStore } from "@/stores/session-store";
import {
  pruneSelection,
  selectionPathspecs,
  toggleFileSelection,
  toggleFolderSelection,
} from "./model";
import { selectCheckoutSelection, useCommitSelectionStore } from "./store";

export interface CommitSelection {
  serverId: string;
  cwd: string;
  filePaths: readonly string[];
  selectedPaths: readonly string[];
  selected: ReadonlySet<string>;
  /** Git pathspecs for the checked files, including renames' old paths. */
  pathspecs: (paths?: readonly string[]) => string[];
  toggleFile: (path: string) => void;
  toggleFolder: (dirPath: string) => void;
  selectAll: () => void;
  selectNone: () => void;
}

export function useCommitSelection(input: {
  serverId: string;
  cwd: string;
  files: readonly ParsedDiffFile[];
  enabled: boolean;
}): CommitSelection | null {
  const { serverId, cwd, files, enabled } = input;
  const checkoutKey = `${serverId}::${cwd}`;
  const supported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutCommitPaths === true,
  );
  const stored = useCommitSelectionStore((state) => selectCheckoutSelection(state, checkoutKey));
  const setSelection = useCommitSelectionStore((state) => state.setSelection);
  const filePaths = useMemo(() => files.map((file) => file.path), [files]);
  const selectedPaths = useMemo(() => pruneSelection(stored, filePaths), [filePaths, stored]);
  useEffect(() => {
    if (selectedPaths !== stored) setSelection(checkoutKey, selectedPaths);
  }, [checkoutKey, selectedPaths, setSelection, stored]);

  const current = useCallback(
    () => selectCheckoutSelection(useCommitSelectionStore.getState(), checkoutKey),
    [checkoutKey],
  );
  const toggleFile = useCallback(
    (path: string) => setSelection(checkoutKey, toggleFileSelection(path, current())),
    [checkoutKey, current, setSelection],
  );
  const toggleFolder = useCallback(
    (dirPath: string) =>
      setSelection(checkoutKey, toggleFolderSelection(dirPath, filePaths, current())),
    [checkoutKey, current, filePaths, setSelection],
  );
  const selectAll = useCallback(
    () => setSelection(checkoutKey, filePaths),
    [checkoutKey, filePaths, setSelection],
  );
  const selectNone = useCallback(() => setSelection(checkoutKey, []), [checkoutKey, setSelection]);
  const pathspecs = useCallback(
    (paths: readonly string[] = selectedPaths) => selectionPathspecs(files, paths),
    [files, selectedPaths],
  );

  return useMemo(
    () =>
      enabled && supported
        ? {
            serverId,
            cwd,
            filePaths,
            selectedPaths,
            selected: new Set(selectedPaths),
            pathspecs,
            toggleFile,
            toggleFolder,
            selectAll,
            selectNone,
          }
        : null,
    [
      cwd,
      enabled,
      filePaths,
      pathspecs,
      selectAll,
      selectNone,
      selectedPaths,
      serverId,
      supported,
      toggleFile,
      toggleFolder,
    ],
  );
}
