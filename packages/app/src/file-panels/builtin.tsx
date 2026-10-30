import { useWorkspace, useFileUrl, type PluginFilePanelProps } from "@getpaseo/plugin/client";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ZoomableImage } from "@/components/zoomable-viewport/image";
import { useSessionStore } from "@/stores/session-store";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";
import { usePaneContext } from "@/panels/pane-context";
import { createPreviewAssetLoader } from "./html-preview-assets";
import { resolvePreviewHtmlLink } from "./html-preview-navigation";
import { FileHtmlPreview } from "./html-preview";
import { FilePanelLoading } from "./loading";
import { FileMarkdownPreview } from "./markdown-preview";
import { TextFilePanel, type TextFilePreviewProps } from "./source/panel";
import type { RenderingFilePanel, SourceFilePanel } from "./catalog";

/** Source: the text file panel with no Preview, for text files no other built-in panel claims. */
function SourcePanel(props: PluginFilePanelProps) {
  return <TextFilePanel {...props} />;
}

/** Markdown: the text file panel with the rendered document as its Preview. */
function MarkdownPanel(props: PluginFilePanelProps) {
  return <TextFilePanel {...props} preview={MarkdownPreview} />;
}

/** HTML: the text file panel with the sandboxed page as its Preview. */
function HtmlPanel(props: PluginFilePanelProps) {
  return <TextFilePanel {...props} preview={HtmlPreview} />;
}

/** Shows Loading until the rendered Markdown has laid out once; later edits keep the content. */
function MarkdownPreview({ text, params, workspaceId, host }: TextFilePreviewProps) {
  const client = useSessionStore((state) => state.sessions[host.id]?.client ?? null);
  const workspaceRoot = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const [rendered, setRendered] = useState(false);
  const handleLayout = useCallback(() => setRendered(true), []);
  return (
    <View style={styles.container}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator>
        <View onLayout={handleLayout}>
          <FileMarkdownPreview
            source={text}
            filePath={params.path}
            workspaceRoot={workspaceRoot ?? ""}
            client={client}
            serverId={host.id}
          />
        </View>
      </ScrollView>
      {rendered ? null : <FilePanelLoading />}
    </View>
  );
}

/** The page owns its scrolling, so there is no ScrollView around it. */
function HtmlPreview({ text, params, workspaceId, host }: TextFilePreviewProps) {
  const client = useSessionStore((state) => state.sessions[host.id]?.client ?? null);
  const workspaceRoot = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const { openFileInWorkspace } = usePaneContext();
  const htmlPath = params.path;
  // CUSTOM(html-preview-assets): lets the page load the images next to it through the daemon.
  const loadAsset = useMemo(() => {
    const target = resolveFilePreviewReadTarget({
      path: htmlPath,
      workspaceRoot: workspaceRoot ?? undefined,
    });
    return client && target
      ? createPreviewAssetLoader({ client, cwd: target.cwd, htmlPath: target.path })
      : undefined;
  }, [client, htmlPath, workspaceRoot]);
  // CUSTOM(html-preview-links): resolve from the file, never the app's srcdoc base URL.
  const openHtmlLink = useCallback(
    (url: string) => {
      const path = resolvePreviewHtmlLink(htmlPath, url);
      if (path) openFileInWorkspace({ location: { path }, disposition: "main" });
    },
    [htmlPath, openFileInWorkspace],
  );
  return (
    <View style={styles.container}>
      <FileHtmlPreview
        html={text}
        testID="file-html-preview"
        loadAsset={loadAsset}
        onOpenHtmlLink={openHtmlLink}
      />
    </View>
  );
}

function ImagePanel({ file }: PluginFilePanelProps) {
  const url = useFileUrl(file);
  if (url.status === "loading") return <FilePanelLoading />;
  if (url.status === "error") return <FilePanelError message={url.error.message} />;
  return <ZoomableImage uri={url.url} testID="image-file-preview" />;
}

function FilePanelError({ message }: { message: string }) {
  return (
    <View style={styles.centerState}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const components = {
  "builtin:markdown": MarkdownPanel,
  "builtin:html": HtmlPanel,
  "builtin:image": ImagePanel,
  "builtin:source": SourcePanel,
};

export function BuiltinFilePanelView({
  panel,
  ...props
}: PluginFilePanelProps & { panel: RenderingFilePanel | SourceFilePanel }) {
  const Component = components[panel.id];
  return <Component {...props} />;
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));
