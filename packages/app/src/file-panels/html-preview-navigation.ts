import { resolvePreviewRelativePath } from "./html-preview-assets";

export type HtmlPreviewNavigationKind = "initialDocument" | "fragment" | "blocked";

const INITIAL_DOCUMENT_URLS = new Set(["about:blank", "about:srcdoc", ""]);

export function htmlPreviewNavigationKind(url: string): HtmlPreviewNavigationKind {
  if (INITIAL_DOCUMENT_URLS.has(url)) return "initialDocument";
  if (url.startsWith("about:blank#") || url.startsWith("about:srcdoc#")) return "fragment";
  return "blocked";
}

// CUSTOM(html-preview-links): relative HTML links open another isolated file pane.
export function resolvePreviewHtmlLink(htmlPath: string, url: string): string | null {
  const path = resolvePreviewRelativePath(htmlPath, url);
  return path && /\.html?$/i.test(path) ? path : null;
}

export function parsePreviewHtmlLink(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  if (!("type" in data) || data.type !== "paseo-preview-html-link") return null;
  return "url" in data && typeof data.url === "string" ? data.url : null;
}

export const PREVIEW_HTML_LINK_SCRIPT = `<script>(function(){
addEventListener("click",function(e){
  if(!e.isTrusted||e.defaultPrevented||e.button!==0)return;
  var a=e.target.closest&&e.target.closest("a[href]");
  if(!a||a.hasAttribute("download"))return;
  var u=a.getAttribute("href");
  if(!u||/^[\\s]*([a-z][a-z0-9+.-]*:|[\\\\/#?])/i.test(u)||!/[.]html?([?#]|$)/i.test(u))return;
  e.preventDefault();
  parent.postMessage({type:"paseo-preview-html-link",url:u},"*");
});
})();</script>`;
