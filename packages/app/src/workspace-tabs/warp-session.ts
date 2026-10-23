// CUSTOM(desk-bottom-panel-warp): opens a Warp session (a tab inside Warp) in a given folder in a
// Warp browser tab. Warp's web build reads `window.PASEO_WARP_PTY_URL` for every new session, so
// pointing its `cwd` at the folder and pressing Ctrl+Shift+T opens the session there. Warp only
// reacts to trusted keys, so the press goes through the webview's `sendInputEvent`; the app
// ignores that key in a bottom-panel Warp tab (bottom-panel-tab-keys).
import { getBrowserRecord } from "@/desktop/browser/store";
import { getResidentBrowserWebview } from "@/desktop/browser/resident-webviews";

interface WarpWebview extends HTMLElement {
  executeJavaScript?: (code: string) => Promise<unknown>;
  sendInputEvent?: (event: {
    type: "keyDown" | "keyUp";
    keyCode: string;
    modifiers: string[];
  }) => void;
}

/** The folder of the last session Paseo opened per Warp browser tab, while the app runs. */
const sessionDirectories = new Map<string, string>();

/** The last folder Paseo opened a session in, else the folder the tab's page started in. */
export function getWarpSessionDirectory(browserId: string): string | null {
  const remembered = sessionDirectories.get(browserId);
  if (remembered) return remembered;
  const url = getBrowserRecord(browserId)?.url;
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("cwd");
  } catch {
    return null;
  }
}

export async function openWarpSession(browserId: string, directory: string): Promise<boolean> {
  const webview = getResidentBrowserWebview(browserId) as WarpWebview | null;
  if (!webview?.executeJavaScript || !webview.sendInputEvent) return false;
  const script = `(() => {
    if (!window.PASEO_WARP_PTY_URL) return false;
    const url = new URL(window.PASEO_WARP_PTY_URL);
    url.searchParams.set("cwd", ${JSON.stringify(directory)});
    window.PASEO_WARP_PTY_URL = url.toString();
    // Warp reads keys on its canvas; a panel that was hidden may have lost that focus.
    document.querySelector("canvas")?.focus();
    return true;
  })()`;
  if ((await webview.executeJavaScript(script)) !== true) return false;
  sessionDirectories.set(browserId, directory);
  webview.focus();
  const modifiers = ["control", "shift"];
  webview.sendInputEvent({ type: "keyDown", keyCode: "T", modifiers });
  webview.sendInputEvent({ type: "keyUp", keyCode: "T", modifiers });
  return true;
}
