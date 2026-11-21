import { resolvePreviewRelativePath } from "./html-preview-assets";
import { useCallback, useEffect, useRef } from "react";
import { useRetainedPanelActive } from "@/components/retained-panel";

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

// CUSTOM(html-preview-anchors): a srcdoc document resolves `#x` against the app's URL, so
// clicking an in-page link navigates the frame to the app instead of scrolling. Handle
// `#x` and `<this file>#x` here; every other link is left to the link script/browser.
export function previewAnchorScript(fileName: string): string {
  const name = JSON.stringify(fileName).replace(/</g, "\\u003c");
  return `<script>(function(){
var self=${name};
function dec(s){try{return decodeURIComponent(s);}catch(_){return s;}}
addEventListener("click",function(e){
  if(!e.isTrusted||e.defaultPrevented||e.button!==0)return;
  var a=e.target.closest&&e.target.closest("a[href]");
  if(!a||a.hasAttribute("download"))return;
  var u=(a.getAttribute("href")||"").trim();
  var i=u.indexOf("#");
  if(i<0)return;
  var p=u.slice(0,i).split("?")[0].replace(/^[.]\\//,"");
  if(p&&dec(p)!==self)return;
  e.preventDefault();
  var id=dec(u.slice(i+1));
  if(!id||id.toLowerCase()==="top"){
    if(document.documentElement.scrollIntoView)document.documentElement.scrollIntoView();else scrollTo(0,0);
    return;
  }
  var t=document.getElementById(id)||document.getElementsByName(id)[0];
  if(t)t.scrollIntoView();
});
})();</script>`;
}

/**
 * Decides each navigation the native WebView asks about: the document loads once, a fragment
 * moves within it, and anything else is refused.
 */
export function useHtmlPreviewNavigationGuard(
  document: string,
): (request: { url: string }) => boolean {
  // Latched per document rather than once for the lifetime of the WebView: the
  // file pane re-renders with new content on every live-file refresh, and each of
  // those is a fresh initial load that has to be allowed through.
  const loadedDocumentRef = useRef<string | null>(null);
  // The latch belongs to one native WebView, not to this component. iOS destroys the WebView of a
  // hidden retained panel and makes a new one when the panel shows, and that one loads the
  // document again. Releasing the latch while hidden lets that load through; a page on a kept
  // WebView gains at most a load of an inert initial URL.
  const active = useRetainedPanelActive();
  useEffect(() => {
    if (!active) loadedDocumentRef.current = null;
  }, [active]);
  return useCallback(
    ({ url }: { url: string }) => {
      const navigationKind = htmlPreviewNavigationKind(url);
      if (navigationKind === "fragment") return true;
      if (navigationKind === "blocked") return false;
      if (loadedDocumentRef.current === document) return false;
      loadedDocumentRef.current = document;
      return true;
    },
    [document],
  );
}
