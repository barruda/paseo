// CUSTOM(chat-file-actions): which actions a chat file link offers, and the commands that run a
// script from its own folder. See hover-actions.tsx.
import { isAbsolutePath } from "@/utils/path";

export type FileLinkKind = "script" | "html" | "other";

export function fileLinkKind(path: string): FileLinkKind {
  const name = path.toLowerCase();
  if (name.endsWith(".sh")) return "script";
  if (name.endsWith(".html") || name.endsWith(".htm")) return "html";
  return "other";
}

/** `path` made absolute against the workspace; `~/…` and absolute paths stay as they are. */
export function joinFileLinkPath(path: string, workspaceRoot: string | undefined): string {
  const normalized = path.replace(/\\/g, "/");
  if (isAbsolutePath(normalized) || normalized.startsWith("~")) return normalized;
  const root = workspaceRoot?.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) return normalized;
  return `${root}/${normalized.replace(/^(\.\/)+/, "")}`;
}

export function splitFileLinkPath(path: string): { directory: string; name: string } {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return { directory: ".", name: path };
  return { directory: slash === 0 ? "/" : path.slice(0, slash), name: path.slice(slash + 1) };
}

/**
 * `inFolder` runs the script from its own folder (Warp opens there); `here` changes to that folder
 * first, for the agent's `!` shell. `bash` because scripts agents write are often not executable.
 */
export function scriptRunCommands(
  directory: string,
  name: string,
): { inFolder: string; here: string } {
  const inFolder = `bash ${shellQuote(`./${name}`)}`;
  return { inFolder, here: `cd ${shellQuote(directory)} && ${inFolder}` };
}

export function shellQuote(value: string): string {
  if (/^[\w./@%+=:,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
