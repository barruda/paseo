// CUSTOM(html-preview-keys): keyboard shortcuts typed inside the HTML preview reach Paseo.
//
// The preview is a sandboxed srcdoc frame, so its key events never reach the app window
// where the shortcut listener lives: Ctrl+Tab inside a preview did nothing. A bridge script
// in the frame posts each modifier combo the page left alone to the parent, which replays
// it as a keydown on the <iframe> element. The page gets first refusal, like the browser
// tab's guest preload: a combo the page cancels is not forwarded. The frame never cancels a
// forwarded combo itself, because it can't know whether Paseo binds it (Ctrl+C in the page
// must keep copying).

const KEY_TYPE = "paseo-preview-key";
const MODIFIER_KEYS = new Set(["Control", "Alt", "Meta", "Shift", "AltGraph"]);

export const PREVIEW_KEY_BRIDGE_SCRIPT = `<script>(function(){
var T=${JSON.stringify(KEY_TYPE)};
function modifierOnly(k){return k==="Control"||k==="Alt"||k==="Meta"||k==="Shift"||k==="AltGraph";}
addEventListener("keydown",function(e){
if(!e.isTrusted||!(e.ctrlKey||e.metaKey||e.altKey)||modifierOnly(e.key))return;
addEventListener("keydown",function(done){
if(done!==e||done.defaultPrevented)return;
parent.postMessage({type:T,key:e.key,code:e.code,ctrlKey:e.ctrlKey,metaKey:e.metaKey,altKey:e.altKey,shiftKey:e.shiftKey,repeat:e.repeat},"*");
},{once:true});
},true);
})();</script>`;

export interface PreviewKey {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

export function parsePreviewKey(data: unknown): PreviewKey | null {
  if (typeof data !== "object" || data === null) return null;
  const value = data as Record<string, unknown>;
  if (value.type !== KEY_TYPE) return null;
  if (typeof value.key !== "string" || typeof value.code !== "string") return null;
  const flags = [value.ctrlKey, value.metaKey, value.altKey, value.shiftKey, value.repeat];
  if (!flags.every((flag) => typeof flag === "boolean")) return null;
  // The page can post this message itself, so the parent enforces the same rule as the bridge.
  if (!(value.ctrlKey || value.metaKey || value.altKey) || MODIFIER_KEYS.has(value.key)) {
    return null;
  }
  return {
    key: value.key,
    code: value.code,
    ctrlKey: value.ctrlKey as boolean,
    metaKey: value.metaKey as boolean,
    altKey: value.altKey as boolean,
    shiftKey: value.shiftKey as boolean,
    repeat: value.repeat as boolean,
  };
}

// Replays the combo where the app's window-level keydown listener sees it.
export function replayPreviewKey(frame: HTMLIFrameElement, key: PreviewKey): void {
  frame.dispatchEvent(new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }));
}
