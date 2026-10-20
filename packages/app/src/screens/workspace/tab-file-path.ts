// CUSTOM(copy-full-file-path): absolute path of a file tab. Tabs opened from chat links to files
// outside the workspace store `~/…` paths, and only the daemon knows what `~` is on its host.
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { isAbsolutePath } from "@/utils/path";

export function isHomeRelativePath(path: string): boolean {
  return path === "~" || path.startsWith("~/") || path.startsWith("~\\");
}

/** Null when the path needs a home directory that was not given. */
export function resolveTabFilePath(input: {
  path: string;
  workspaceDirectory: string;
  home: string | null;
}): string | null {
  const { path, workspaceDirectory, home } = input;
  if (isAbsolutePath(path)) return path;
  if (!isHomeRelativePath(path)) {
    return buildAbsoluteExplorerPath({ workspaceRoot: workspaceDirectory, entryPath: path });
  }
  if (!home) return null;
  return buildAbsoluteExplorerPath({ workspaceRoot: home, entryPath: path.slice(2) || "." });
}

/**
 * The explorer lists `~` relative to the workspace: "." when the workspace is the home, the
 * absolute home otherwise (explorer-outside-workspace returns paths outside the root absolute).
 */
export function homeFromListedPath(listedPath: string, workspaceDirectory: string): string | null {
  if (isAbsolutePath(listedPath)) return listedPath;
  if (listedPath === ".") return workspaceDirectory;
  // A daemon without explorer-outside-workspace answers with `../..` or refuses.
  return null;
}
