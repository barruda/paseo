import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { withPreviewCsp } from "./html-preview-csp";
import {
  PREVIEW_ASSET_BRIDGE_SCRIPT,
  parsePreviewAssetRequest,
  respondToPreviewAssetRequest,
  type PreviewAssetLoader,
} from "./html-preview-assets";
// CUSTOM(html-preview-keys)
import { PREVIEW_KEY_BRIDGE_SCRIPT, parsePreviewKey, replayPreviewKey } from "./html-preview-keys";

// `allow-scripts` alone: the file gets an opaque origin, so a plan page can run
// its own scripts (Excalidraw, charts) but cannot reach the Paseo app's DOM,
// cookies, or storage, and cannot navigate the top window. Agent-written HTML is
// not trusted markup. No popup tokens — a preview is a viewer, not a browser, and
// escaping the sandbox to open one buys nothing for reading a local plan. The same
// isolation means storage APIs throw inside the frame; pages that want to persist
// state have to export.
//
// A sandboxed frame may still navigate *itself*, and nothing in CSP stops that
// (see html-preview-csp.ts). That is the one hole left on web, it is bounded to
// the page's own contents, and it is documented in SECURITY.md rather than papered
// over with a directive browsers ignore.
const SANDBOX = "allow-scripts";

const iframeStyle = {
  flex: 1,
  minHeight: 0,
  border: "none",
  backgroundColor: "white",
} as const;

export function FileHtmlPreview({
  html,
  testID,
  loadAsset,
}: {
  html: string;
  testID?: string;
  loadAsset?: PreviewAssetLoader;
}) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  // CUSTOM(html-preview-assets): serve the page's sibling images through the bridge.
  const hasAssets = Boolean(loadAsset);
  const document = useMemo(
    () =>
      withPreviewCsp(
        html,
        // CUSTOM(html-preview-keys): forward shortcuts typed in the frame.
        PREVIEW_KEY_BRIDGE_SCRIPT + (hasAssets ? PREVIEW_ASSET_BRIDGE_SCRIPT : ""),
      ),
    [html, hasAssets],
  );
  useEffect(() => {
    if (!loadAsset) return;
    function receive(event: MessageEvent) {
      const frame = frameRef.current?.contentWindow;
      if (!frame || event.source !== frame || !loadAsset) return;
      const request = parsePreviewAssetRequest(event.data);
      if (!request) return;
      loadAsset(request.url).then(
        (asset) => respondToPreviewAssetRequest(frame, request, asset),
        () => respondToPreviewAssetRequest(frame, request, null),
      );
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [loadAsset]);
  // CUSTOM(html-preview-keys): replay forwarded shortcuts so the app's listener sees them.
  useEffect(() => {
    function receive(event: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const key = parsePreviewKey(event.data);
      if (key) replayPreviewKey(frame, key);
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  return (
    <iframe
      ref={frameRef}
      data-testid={testID}
      title={t("panels.file.editor.preview")}
      srcDoc={document}
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      style={iframeStyle}
    />
  );
}
