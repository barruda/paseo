// CUSTOM(html-preview-assets): lets a previewed HTML file show the images that sit
// next to it, such as a gallery's `images/01.png`.
//
// The preview stays an opaque-origin srcdoc frame under the CSP in
// html-preview-csp.ts, so the page still cannot fetch anything itself. A bridge
// script injected ahead of the document watches `<img src>` and asks the parent
// window for each relative URL. The parent reads the file through the daemon and
// posts the bytes back, and the bridge swaps in a `blob:` URL, which the CSP
// already allows.
//
// What the page can reach this way is bounded here, not in the frame: image files
// in the HTML file's own folder or below it. A URL that climbs above that folder,
// carries a scheme, or names another kind of file is refused before any read.
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

const REQUEST_TYPE = "paseo-preview-asset-request";
const RESPONSE_TYPE = "paseo-preview-asset-response";

const MAX_ASSET_BYTES = 32 * 1024 * 1024;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

export interface PreviewAsset {
  bytes: Uint8Array;
  mime: string;
}

export type PreviewAssetLoader = (url: string) => Promise<PreviewAsset | null>;

export interface PreviewAssetRequest {
  id: string;
  url: string;
}

function imageMimeForPath(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return IMAGE_MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * Resolves a URL from the previewed page against the HTML file's folder. Returns
 * null for anything the preview must not read: URLs with a scheme or host,
 * root-relative paths, paths that climb above the folder, and non-image files.
 */
export function resolvePreviewAssetPath(htmlPath: string, url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /^[\\/#?]/.test(trimmed)) {
    return null;
  }
  const withoutSuffix = trimmed.replace(/[?#].*$/, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutSuffix);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  const segments: string[] = [];
  for (const segment of decoded.split(/[\\/]/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) return null;

  const relativePath = segments.join("/");
  if (!imageMimeForPath(relativePath)) return null;

  const separator = Math.max(htmlPath.lastIndexOf("/"), htmlPath.lastIndexOf("\\"));
  const folder = separator >= 0 ? htmlPath.slice(0, separator) : "";
  return folder ? `${folder}/${relativePath}` : relativePath;
}

export function createPreviewAssetLoader(input: {
  client: DaemonClient;
  cwd: string;
  htmlPath: string;
}): PreviewAssetLoader {
  const { client, cwd, htmlPath } = input;
  return async (url) => {
    const path = resolvePreviewAssetPath(htmlPath, url);
    const mime = path ? imageMimeForPath(path) : null;
    if (!path || !mime) return null;
    const file = await client.readFile(cwd, path, undefined, MAX_ASSET_BYTES);
    return { bytes: file.bytes, mime };
  };
}

export function parsePreviewAssetRequest(data: unknown): PreviewAssetRequest | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.type !== REQUEST_TYPE) return null;
  if (typeof message.id !== "string" || typeof message.url !== "string") return null;
  return { id: message.id, url: message.url };
}

export function respondToPreviewAssetRequest(
  target: Window,
  request: PreviewAssetRequest,
  asset: PreviewAsset | null,
): void {
  if (!asset) {
    target.postMessage({ type: RESPONSE_TYPE, id: request.id }, "*");
    return;
  }
  // Copy into a buffer of its own: the read result can be a view into a larger one.
  const buffer = asset.bytes.slice().buffer;
  target.postMessage(
    { type: RESPONSE_TYPE, id: request.id, bytes: buffer, mime: asset.mime },
    "*",
    [buffer],
  );
}

// Runs inside the preview frame, ahead of the document. Images the page builds
// without attaching them (`new Image()` for a canvas) and CSS `url()` are not
// covered; only `<img src>` in the document is.
export const PREVIEW_ASSET_BRIDGE_SCRIPT = `<script>(function(){
var REQ=${JSON.stringify(REQUEST_TYPE)},RES=${JSON.stringify(RESPONSE_TYPE)};
var token=Math.random().toString(36).slice(2),next=0,pending=new Map(),cache=new Map();
function relative(u){return !!u&&!/^\\s*(?:[a-z][a-z0-9+.-]*:|[\\\\/#?])/i.test(u);}
function load(u){var p=cache.get(u);if(p)return p;p=new Promise(function(resolve){var id=token+":"+(++next);pending.set(id,resolve);parent.postMessage({type:REQ,id:id,url:u},"*");});cache.set(u,p);return p;}
addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||d.type!==RES)return;var resolve=pending.get(d.id);if(!resolve)return;pending.delete(d.id);resolve(d.bytes?URL.createObjectURL(new Blob([d.bytes],{type:d.mime})):null);});
function fix(img){var u=img.getAttribute("src");if(!relative(u))return;load(u).then(function(blob){if(blob&&img.getAttribute("src")===u)img.setAttribute("src",blob);});}
function scan(node){if(node.nodeType!==1)return;if(node.tagName==="IMG")fix(node);if(node.querySelectorAll)node.querySelectorAll("img[src]").forEach(fix);}
new MutationObserver(function(records){records.forEach(function(r){if(r.type==="attributes")scan(r.target);else r.addedNodes.forEach(scan);});}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:["src"]});
})();</script>`;
