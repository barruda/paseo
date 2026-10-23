// CUSTOM(bottom-panel-warp-tab-button): opens a session (a tab inside Warp) in a given folder in a
// Warp browser tab. Warp's web build reads `window.PASEO_WARP_PTY_URL` for every new session, and
// our Warp patch opens a terminal tab on a `paseo-warp-new-tab` window event, so pointing the URL's
// `cwd` at the folder and dispatching the event opens the session there. A synthetic Ctrl+Shift+T
// doesn't work: Warp ignores key events dispatched from JavaScript, and the webview's
// `sendInputEvent` didn't reach it either.
import { getResidentBrowserWebview } from "@/desktop/browser/resident-webviews";

interface WarpWebview extends HTMLElement {
  executeJavaScript?: (code: string) => Promise<unknown>;
}

export async function openWarpSession(browserId: string, directory: string): Promise<boolean> {
  const webview = getResidentBrowserWebview(browserId) as WarpWebview | null;
  if (!webview?.executeJavaScript) return false;
  const script = `(() => {
    if (!window.PASEO_WARP_PTY_URL) return false;
    const url = new URL(window.PASEO_WARP_PTY_URL);
    url.searchParams.set("cwd", ${JSON.stringify(directory)});
    window.PASEO_WARP_PTY_URL = url.toString();
    window.dispatchEvent(new Event("paseo-warp-new-tab"));
    return true;
  })()`;
  const opened = (await webview.executeJavaScript(script)) === true;
  if (opened) webview.focus();
  return opened;
}
