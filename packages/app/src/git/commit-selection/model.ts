// CUSTOM(commit-selection): which changed files the Changes tree has checked for a commit.
// Selections are file paths; a folder's checkbox derives from the files under it.

export type CommitCheckState = "checked" | "unchecked" | "mixed";

interface SelectableFile {
  path: string;
  oldPath?: string;
}

export function filesUnderFolder(dirPath: string, filePaths: readonly string[]): string[] {
  const prefix = `${dirPath}/`;
  return filePaths.filter((path) => path.startsWith(prefix));
}

export function folderCheckState(
  dirPath: string,
  filePaths: readonly string[],
  selected: ReadonlySet<string>,
): CommitCheckState {
  const under = filesUnderFolder(dirPath, filePaths);
  const count = under.filter((path) => selected.has(path)).length;
  if (count === 0) return "unchecked";
  return count === under.length ? "checked" : "mixed";
}

/** A fully checked folder clears its files; otherwise it checks all of them. */
export function toggleFolderSelection(
  dirPath: string,
  filePaths: readonly string[],
  selected: readonly string[],
): string[] {
  const under = filesUnderFolder(dirPath, filePaths);
  const current = new Set(selected);
  if (folderCheckState(dirPath, filePaths, current) === "checked") {
    return selected.filter((path) => !under.includes(path));
  }
  return [...selected, ...under.filter((path) => !current.has(path))];
}

export function toggleFileSelection(path: string, selected: readonly string[]): string[] {
  return selected.includes(path) ? selected.filter((entry) => entry !== path) : [...selected, path];
}

/** Drops paths that are no longer changed. Returns `selected` itself when nothing dropped. */
export function pruneSelection(
  selected: readonly string[],
  filePaths: readonly string[],
): readonly string[] {
  const present = new Set(filePaths);
  return selected.every((path) => present.has(path))
    ? selected
    : selected.filter((path) => present.has(path));
}

/** Git pathspecs for the selection: a rename needs its old path too. */
export function selectionPathspecs(
  files: readonly SelectableFile[],
  selected: readonly string[],
): string[] {
  const chosen = new Set(selected);
  return files.flatMap((file) => {
    if (!chosen.has(file.path)) return [];
    return file.oldPath && file.oldPath !== file.path ? [file.path, file.oldPath] : [file.path];
  });
}

interface ComparableFile {
  path: string;
  additions: number;
  deletions: number;
}

/** True when the daemon's current changes differ from the list on screen. */
export function changesDifferFromList(
  listed: readonly ComparableFile[],
  current: readonly ComparableFile[],
): boolean {
  if (listed.length !== current.length) return true;
  const byPath = new Map(listed.map((file) => [file.path, file]));
  return current.some((file) => {
    const shown = byPath.get(file.path);
    return !shown || shown.additions !== file.additions || shown.deletions !== file.deletions;
  });
}
