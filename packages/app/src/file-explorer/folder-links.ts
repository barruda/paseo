// CUSTOM(explorer-folder-links): folder links in chat open in the Files sidebar. A folder inside
// the workspace is revealed in the tree; a folder outside it becomes the sidebar's temporary root.
import { create } from "zustand";
import { isAbsolutePath } from "@/utils/path";

interface FolderLinkRequest {
  path: string;
  nonce: number;
}

interface FolderLinkState {
  /** Folder links clicked in chat, keyed by workspace explorer state key. Absolute paths. */
  requests: Record<string, FolderLinkRequest>;
  /** Temporary explorer roots for folders outside the workspace. Absolute paths. */
  externalRoots: Record<string, string>;
  /** Folders to reveal in the workspace tree. Workspace-relative paths. */
  reveals: Record<string, FolderLinkRequest>;
  requestFolder: (key: string, absolutePath: string) => void;
  takeRequest: (key: string, nonce: number) => void;
  setExternalRoot: (key: string, root: string | null) => void;
  requestReveal: (key: string, relativePath: string) => void;
  takeReveal: (key: string, nonce: number) => void;
}

let nextNonce = 1;

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export const useFolderLinkStore = create<FolderLinkState>()((set) => ({
  requests: {},
  externalRoots: {},
  reveals: {},
  requestFolder: (key, absolutePath) =>
    set((state) => ({
      requests: { ...state.requests, [key]: { path: absolutePath, nonce: nextNonce++ } },
    })),
  takeRequest: (key, nonce) =>
    set((state) =>
      state.requests[key]?.nonce === nonce ? { requests: withoutKey(state.requests, key) } : state,
    ),
  setExternalRoot: (key, root) =>
    set((state) => ({
      externalRoots: root
        ? { ...state.externalRoots, [key]: root }
        : withoutKey(state.externalRoots, key),
    })),
  requestReveal: (key, relativePath) =>
    set((state) => ({
      reveals: { ...state.reveals, [key]: { path: relativePath, nonce: nextNonce++ } },
    })),
  takeReveal: (key, nonce) =>
    set((state) =>
      state.reveals[key]?.nonce === nonce ? { reveals: withoutKey(state.reveals, key) } : state,
    ),
}));

function trimTrailingSlashes(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "/";
}

export type FolderLinkTarget =
  | { kind: "workspace"; relativePath: string }
  | { kind: "external"; root: string };

/** Decides whether a clicked folder lives in the workspace tree or needs its own root. */
export function resolveFolderLinkTarget(input: {
  workspaceRoot: string;
  absolutePath: string;
}): FolderLinkTarget {
  const root = trimTrailingSlashes(input.workspaceRoot.trim().replace(/\\/g, "/"));
  const target = trimTrailingSlashes(input.absolutePath.trim().replace(/\\/g, "/"));
  if (target === root) {
    return { kind: "workspace", relativePath: "." };
  }
  const prefix = root === "/" ? "/" : `${root}/`;
  if (target.startsWith(prefix)) {
    return { kind: "workspace", relativePath: target.slice(prefix.length) };
  }
  return { kind: "external", root: target };
}

/** Workspace-relative folders to expand so `path` shows in the tree, outermost first. */
export function explorerAncestorPaths(path: string): string[] {
  if (path === "." || path.length === 0) return [];
  const segments = path.split("/").filter(Boolean);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

/** Absolute path of an inline link target, resolved against the agent's cwd. */
export function absoluteInlinePath(path: string, cwd: string | undefined): string | null {
  if (isAbsolutePath(path)) return trimTrailingSlashes(path);
  const base = cwd?.trim();
  if (!base || !isAbsolutePath(base)) return null;
  if (path === ".") return trimTrailingSlashes(base);
  return `${trimTrailingSlashes(base).replace(/\/$/, "")}/${path.replace(/^\.\//, "")}`;
}

/**
 * Whether an inline link without a trailing slash may name a folder. Names with an extension
 * (`notes.md`, `.bashrc`) are files; the rest are checked with the daemon before opening.
 */
export function mayBeFolderPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.length > 0 && !name.includes(".");
}

/** The filesystem root that contains an absolute path: `/`, or a drive root like `C:/`. */
export function filesystemRootOf(absolutePath: string): string {
  const drive = /^([A-Za-z]:)[\\/]/.exec(absolutePath);
  return drive ? `${drive[1]}/` : "/";
}
