// CUSTOM(html-preview-url): desktop serves an HTML preview from a real URL.
//
// `paseo-preview://<token>/<path>` is handled by the Electron main process
// (packages/desktop/src/features/html-preview-protocol.ts), which asks this renderer for each
// file. The renderer reads it through the daemon client it already has, so remote hosts work.
// The page then behaves like a page in a browser: relative links navigate the frame in place,
// anchors scroll, and CSS, scripts, images and fonts load from the same origin.
import { useEffect, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";
import { getDesktopHost, type DesktopHtmlPreviewReadRequest } from "@/desktop/host";
import { withPreviewPrologue } from "./html-preview-csp";
import { PREVIEW_KEY_BRIDGE_SCRIPT } from "./html-preview-keys";

const MAX_BYTES = 32 * 1024 * 1024;

export interface HtmlPreviewSource {
  client: DaemonClient;
  cwd: string;
  /** Folder the URL paths are relative to. Empty when paths are relative to `cwd`. */
  base: string;
  /** The HTML file, relative to `base`. This is the frame's initial URL path. */
  path: string;
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

export function resolveHtmlPreviewSource(input: {
  client: DaemonClient | null;
  htmlPath: string;
  workspaceRoot?: string;
}): HtmlPreviewSource | null {
  const { client, htmlPath, workspaceRoot } = input;
  const target = resolveFilePreviewReadTarget({ path: htmlPath, workspaceRoot });
  if (!client || !target) return null;

  const root = workspaceRoot?.trim();
  if (root && target.cwd === root) {
    const normalizedRoot = normalizeSlashes(root).replace(/\/+$/, "");
    const normalizedPath = normalizeSlashes(target.path);
    const prefix = `${normalizedRoot}/`;
    const inside = normalizedPath.startsWith(prefix)
      ? normalizedPath.slice(prefix.length)
      : normalizedPath;
    if (inside && isSafeRequestPath(inside)) {
      return { client, cwd: target.cwd, base: "", path: inside };
    }
    return null;
  }

  const normalized = normalizeSlashes(target.path);
  const separator = normalized.lastIndexOf("/");
  if (separator < 0) return null;
  const name = normalized.slice(separator + 1);
  if (!name) return null;
  return {
    client,
    cwd: target.cwd,
    base: separator === 0 ? "/" : normalized.slice(0, separator),
    path: name,
  };
}

export function encodePreviewUrlPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function previewUrl(token: string, path: string): string {
  return `paseo-preview://${token}/${encodePreviewUrlPath(path)}`;
}

/** Rejects anything that is not a plain relative path: `..`, NUL, absolute, drive letters. */
export function isSafeRequestPath(path: string): boolean {
  if (!path || path.includes("\0")) return false;
  if (path.startsWith("/") || path.startsWith("\\") || /^[a-z]:/i.test(path)) return false;
  return !path.split(/[\\/]/).some((segment) => segment === "..");
}

export function joinPreviewBase(base: string, path: string): string {
  if (!base) return path;
  return base.endsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

export type HtmlPreviewReadResult = { status: "ok"; bytes: Uint8Array } | { status: "not-found" };

const HTML_EXTENSION = /\.html?$/i;

export async function readHtmlPreviewFile(
  source: HtmlPreviewSource,
  path: string,
): Promise<HtmlPreviewReadResult> {
  if (!isSafeRequestPath(path)) return { status: "not-found" };
  try {
    const file = await source.client.readFile(
      source.cwd,
      joinPreviewBase(source.base, path),
      undefined,
      MAX_BYTES,
    );
    if (!HTML_EXTENSION.test(path)) return { status: "ok", bytes: file.bytes };
    // The key bridge forwards app shortcuts typed inside the frame to Paseo.
    const text = new TextDecoder().decode(file.bytes);
    const bytes = new TextEncoder().encode(withPreviewPrologue(text, PREVIEW_KEY_BRIDGE_SCRIPT));
    return { status: "ok", bytes };
  } catch {
    return { status: "not-found" };
  }
}

/** Opens a preview session and returns the URL of the source file, or null while pending. */
export function useHtmlPreviewUrl(source: HtmlPreviewSource | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const bridge = getDesktopHost()?.htmlPreview;
    if (!bridge || !source) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let opened: string | null = null;
    let unsubscribe: (() => void) | null = null;
    const serve = async (request: DesktopHtmlPreviewReadRequest) => {
      const result = await readHtmlPreviewFile(source, request.path);
      await bridge.respond({ requestId: request.requestId, ...result });
    };
    const start = async () => {
      let token: string;
      try {
        token = await bridge.open();
      } catch {
        if (!cancelled) setUrl(null);
        return;
      }
      if (cancelled) {
        void bridge.close(token);
        return;
      }
      opened = token;
      unsubscribe = bridge.onReadRequest((request) => {
        if (request.token === token) void serve(request);
      });
      setUrl(previewUrl(token, source.path));
    };
    void start();
    return () => {
      cancelled = true;
      unsubscribe?.();
      if (opened) void bridge.close(opened);
      setUrl(null);
    };
  }, [source]);
  return url;
}
