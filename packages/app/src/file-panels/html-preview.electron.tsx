// CUSTOM(html-preview-url): on desktop the preview loads from paseo-preview://<token>/<path>,
// so relative links, anchors, CSS, scripts and images work as in a browser. Without the
// desktop bridge or a source it falls back to the srcdoc implementation.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getDesktopHost } from "@/desktop/host";
import { parsePreviewKey, replayPreviewKey } from "./html-preview-keys";
import type { PreviewAssetLoader } from "./html-preview-assets";
import { FilePanelLoading } from "./loading";
import { FileHtmlPreview as WebFileHtmlPreview } from "./html-preview.web";
import { useHtmlPreviewUrl, type HtmlPreviewSource } from "./html-preview-url";

const SANDBOX = "allow-scripts";

const iframeStyle = {
  flex: 1,
  minHeight: 0,
  border: "none",
  backgroundColor: "white",
} as const;

interface FileHtmlPreviewProps {
  html: string;
  testID?: string;
  loadAsset?: PreviewAssetLoader;
  onOpenHtmlLink?: (url: string) => void;
  fileName?: string;
  source?: HtmlPreviewSource | null;
}

export function FileHtmlPreview(props: FileHtmlPreviewProps) {
  const source = props.source ?? null;
  const hasBridge = Boolean(getDesktopHost()?.htmlPreview);
  if (!hasBridge || !source) return <WebFileHtmlPreview {...props} />;
  return <UrlHtmlPreview html={props.html} testID={props.testID} source={source} />;
}

function UrlHtmlPreview({
  html,
  testID,
  source,
}: {
  html: string;
  testID?: string;
  source: HtmlPreviewSource;
}) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const url = useHtmlPreviewUrl(source);
  const [reloadCount, setReloadCount] = useState(0);
  const lastHtmlRef = useRef(html);
  // Live refresh: the file changed on disk, so reload the frame from the pane's file.
  useEffect(() => {
    if (lastHtmlRef.current === html) return;
    lastHtmlRef.current = html;
    setReloadCount((count) => count + 1);
  }, [html]);
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
  if (!url) return <FilePanelLoading />;
  return (
    <iframe
      ref={frameRef}
      data-testid={testID}
      title={t("panels.file.filePanels.builtin.html")}
      src={reloadCount ? `${url}?v=${reloadCount}` : url}
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      style={iframeStyle}
    />
  );
}
