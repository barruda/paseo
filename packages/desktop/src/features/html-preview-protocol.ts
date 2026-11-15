// CUSTOM(html-preview-url): serve HTML file previews from a real URL.
//
// The file pane used to render an HTML preview as an `<iframe srcdoc>`, which has no URL, so
// relative links, anchors, CSS, scripts and fonts all needed hand-written bridges. On desktop the
// iframe now loads `paseo-preview://<token>/<path>`. The bytes come from the renderer that opened
// the session, through the daemon client it already holds, so remote hosts keep working. The main
// process only parses the URL, asks that renderer for the file, and attaches the response policy.
//
// `protocol.handle` on the global `protocol` binds to the default session only. The Paseo browser
// webviews use their own partition (PASEO_BROWSER_PROFILE_PARTITION) and cannot reach this scheme.
import crypto from "node:crypto";
import type { IpcMain, IpcMainInvokeEvent, Protocol, WebContents } from "electron";

export const HTML_PREVIEW_SCHEME = "paseo-preview";

const READ_TIMEOUT_MS = 30_000;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export interface HtmlPreviewReadRequest {
  requestId: string;
  token: string;
  path: string;
}

export type HtmlPreviewReadResponse =
  | { requestId: string; status: "ok"; bytes: Uint8Array }
  | { requestId: string; status: "not-found" };

export interface HtmlPreviewResult {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

const TEXT_MIME: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  md: "text/plain",
  txt: "text/plain",
  csv: "text/plain",
  log: "text/plain",
};

const BINARY_MIME: Record<string, string> = {
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

export function mimeForPreviewPath(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const text = TEXT_MIME[extension];
  if (text) return `${text}; charset=utf-8`;
  if (extension === "json") return "application/json; charset=utf-8";
  if (extension === "svg") return "image/svg+xml";
  return BINARY_MIME[extension] ?? "application/octet-stream";
}

export function buildHtmlPreviewCsp(origin: string): string {
  return [
    "default-src 'none'",
    `script-src ${origin} 'unsafe-inline' 'unsafe-eval' blob:`,
    `style-src ${origin} 'unsafe-inline'`,
    `img-src ${origin} data: blob:`,
    `font-src ${origin} data:`,
    `media-src ${origin} data: blob:`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "sandbox allow-scripts",
  ].join("; ");
}

/** True when a decoded relative path stays inside its base. Shared rule: no `..`, NUL, or absolute. */
export function isSafePreviewPath(path: string): boolean {
  if (!path || path.includes("\0")) return false;
  if (path.startsWith("/") || path.startsWith("\\") || /^[a-z]:/i.test(path)) return false;
  return !path.split(/[\\/]/).some((segment) => segment === "..");
}

export function parseHtmlPreviewRequestUrl(rawUrl: string): { token: string; path: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${HTML_PREVIEW_SCHEME}:`) return null;
  const token = url.hostname;
  if (!TOKEN_PATTERN.test(token)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const path = decoded.startsWith("/") ? decoded.slice(1) : decoded;
  if (!isSafePreviewPath(path)) return null;
  return { token, path };
}

export function parseHtmlPreviewReadResponse(payload: unknown): HtmlPreviewReadResponse | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.requestId !== "string") return null;
  if (value.status === "not-found") return { requestId: value.requestId, status: "not-found" };
  if (value.status === "ok" && value.bytes instanceof Uint8Array) {
    return { requestId: value.requestId, status: "ok", bytes: value.bytes };
  }
  return null;
}

function responseHeaders(token: string, path: string): Record<string, string> {
  return {
    "Content-Type": mimeForPreviewPath(path),
    "Content-Security-Policy": buildHtmlPreviewCsp(`${HTML_PREVIEW_SCHEME}://${token}`),
    "X-Content-Type-Options": "nosniff",
    // The frame has an opaque origin, so module scripts and fonts are CORS requests.
    // `connect-src 'none'` still blocks fetch and XHR.
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
}

interface PendingRead {
  webContentsId: number;
  resolve: (response: HtmlPreviewReadResponse | "timeout" | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface HtmlPreviewService {
  open(webContentsId: number): string;
  close(token: string, webContentsId: number): void;
  dropWebContents(webContentsId: number): void;
  respond(webContentsId: number, payload: unknown): void;
  handleRequest(rawUrl: string): Promise<HtmlPreviewResult>;
}

export function createHtmlPreviewService(deps: {
  sendReadRequest: (webContentsId: number, request: HtmlPreviewReadRequest) => boolean;
  timeoutMs?: number;
}): HtmlPreviewService {
  const timeoutMs = deps.timeoutMs ?? READ_TIMEOUT_MS;
  const sessions = new Map<string, { webContentsId: number }>();
  const pending = new Map<string, PendingRead>();

  function settle(requestId: string, response: HtmlPreviewReadResponse | null): void {
    const read = pending.get(requestId);
    if (!read) return;
    pending.delete(requestId);
    clearTimeout(read.timer);
    read.resolve(response);
  }

  function failPending(webContentsId: number): void {
    for (const [requestId, read] of pending) {
      if (read.webContentsId === webContentsId) settle(requestId, null);
    }
  }

  return {
    open(webContentsId) {
      const token = crypto.randomBytes(16).toString("hex");
      sessions.set(token, { webContentsId });
      return token;
    },
    close(token, webContentsId) {
      if (sessions.get(token)?.webContentsId !== webContentsId) return;
      sessions.delete(token);
    },
    dropWebContents(webContentsId) {
      for (const [token, session] of sessions) {
        if (session.webContentsId === webContentsId) sessions.delete(token);
      }
      failPending(webContentsId);
    },
    respond(webContentsId, payload) {
      const response = parseHtmlPreviewReadResponse(payload);
      if (!response) return;
      const read = pending.get(response.requestId);
      if (!read || read.webContentsId !== webContentsId) return;
      settle(response.requestId, response);
    },
    async handleRequest(rawUrl) {
      const parsed = parseHtmlPreviewRequestUrl(rawUrl);
      const fallbackToken = parsed?.token ?? "0".repeat(32);
      const fail = (status: number): HtmlPreviewResult => ({
        status,
        headers: { ...responseHeaders(fallbackToken, ""), "Content-Type": "text/plain" },
        body: null,
      });
      if (!parsed) return fail(404);
      const session = sessions.get(parsed.token);
      if (!session) return fail(404);

      const requestId = crypto.randomUUID();
      const result = new Promise<HtmlPreviewReadResponse | "timeout" | null>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          resolve("timeout");
        }, timeoutMs);
        pending.set(requestId, { webContentsId: session.webContentsId, resolve, timer });
      });
      const sent = deps.sendReadRequest(session.webContentsId, {
        requestId,
        token: parsed.token,
        path: parsed.path,
      });
      if (!sent) {
        settle(requestId, null);
        return fail(404);
      }
      const response = await result;
      if (response === "timeout") return fail(504);
      if (!response || response.status !== "ok") return fail(404);
      return {
        status: 200,
        headers: responseHeaders(parsed.token, parsed.path),
        body: response.bytes,
      };
    },
  };
}

export function registerHtmlPreviewProtocol(deps: {
  ipcMain: IpcMain;
  protocol: Protocol;
  webContents: { fromId(id: number): WebContents | undefined };
}): void {
  const { ipcMain, protocol, webContents } = deps;
  const watched = new Set<number>();
  const service = createHtmlPreviewService({
    sendReadRequest: (id, request) => {
      const target = webContents.fromId(id);
      if (!target || target.isDestroyed()) return false;
      target.send("paseo:html-preview:read-request", request);
      return true;
    },
  });

  ipcMain.handle("paseo:html-preview:open", (event: IpcMainInvokeEvent) => {
    const sender = event.sender;
    if (!watched.has(sender.id)) {
      watched.add(sender.id);
      const id = sender.id;
      sender.once("destroyed", () => {
        watched.delete(id);
        service.dropWebContents(id);
      });
    }
    return service.open(sender.id);
  });
  ipcMain.handle("paseo:html-preview:close", (event: IpcMainInvokeEvent, token: unknown) => {
    if (typeof token === "string") service.close(token, event.sender.id);
  });
  ipcMain.handle(
    "paseo:html-preview:read-response",
    (event: IpcMainInvokeEvent, payload: unknown) => {
      service.respond(event.sender.id, payload);
    },
  );

  protocol.handle(HTML_PREVIEW_SCHEME, async (request) => {
    const result = await service.handleRequest(request.url);
    return new Response(result.body ? new Blob([result.body as BlobPart]) : null, {
      status: result.status,
      headers: result.headers,
    });
  });
}
