// CUSTOM(session-file-paths): agents often name a file by its basename or a path relative to
// wherever they were working (`deploy.sh`, `scripts/deploy.sh`), not by its full path. The files
// the agent read, edited, wrote or found in this session carry their full paths in the tool calls,
// and the file it talks about is almost always one of them. Resolving against those first finds
// files outside the workspace too, where the daemon's suffix lookup never looks.
import { useMemo, useRef } from "react";
import { isAgentToolCallItem, type AgentToolCallItem, type StreamItem } from "@/types/stream";
import { isAbsolutePath } from "@/utils/path";

/** The full paths of the files the agent's tool calls touched, newest first, without repeats. */
export function collectSessionFilePaths(
  items: readonly StreamItem[],
  cwd: string | undefined,
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (!isAgentToolCallItem(item)) continue;
    const { detail } = item.payload.data;
    for (const candidate of toolCallFilePaths(detail)) {
      const absolute = toAbsolute(candidate, cwd);
      if (!absolute || seen.has(absolute)) continue;
      seen.add(absolute);
      paths.push(absolute);
    }
  }
  return paths;
}

/**
 * The newest session path that `token` names: the same path, or one ending in `/<token>`. Null
 * for absolute tokens, which need no guessing.
 */
export function matchSessionFilePath(
  token: string,
  sessionPaths: readonly string[] | undefined,
): string | null {
  if (!sessionPaths?.length) return null;
  const normalized = token
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "");
  if (!normalized || isAbsolutePath(normalized) || normalized.startsWith("~")) return null;
  if (normalized.startsWith("../") || normalized.endsWith("/")) return null;
  const suffix = `/${normalized}`;
  return sessionPaths.find((path) => path.endsWith(suffix)) ?? null;
}

function toolCallFilePaths(detail: AgentToolCallItem["payload"]["data"]["detail"]): string[] {
  if (detail.type === "read" || detail.type === "edit" || detail.type === "write") {
    return [detail.filePath];
  }
  if (detail.type === "search") return detail.filePaths ?? [];
  return [];
}

function toAbsolute(path: string, cwd: string | undefined): string | null {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized) return null;
  if (isAbsolutePath(normalized)) return normalized;
  const root = cwd?.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) return null;
  return `${root}/${normalized.replace(/^(\.\/)+/, "")}`;
}

/**
 * The session's file paths, across the history (tail) and the live turn (head). Keeps the same
 * array while the paths are unchanged, so streaming text doesn't re-resolve every link.
 */
export function useSessionFilePaths(
  tail: readonly StreamItem[],
  head: readonly StreamItem[] | undefined,
  cwd: string | undefined,
): readonly string[] {
  const previous = useRef<{ key: string; paths: readonly string[] }>({ key: "", paths: [] });
  return useMemo(() => {
    const paths = collectSessionFilePaths(head?.length ? [...tail, ...head] : tail, cwd);
    const key = paths.join("\n");
    if (key !== previous.current.key) previous.current = { key, paths };
    return previous.current.paths;
  }, [tail, head, cwd]);
}
