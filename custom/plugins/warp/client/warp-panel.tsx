import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { openWarpSessionRpc } from "../shared/warp";

type Theme = PluginWorkspacePanelProps["theme"];

/**
 * Plugin panels can't host a web page, so this panel opens Warp in a workspace browser tab
 * (Electron) and stays as a launcher for more sessions. Elsewhere it shows a link instead.
 */
export function WarpPanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const toast = useToast();
  const openSession = useRpc(openWarpSessionRpc);
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const openBrowser = navigation?.openBrowser;
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opened = useRef(false);
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);

  const open = useCallback(async () => {
    if (!directory) return;
    setBusy(true);
    try {
      const { url } = await openSession({ cwd: directory });
      if (openBrowser) openBrowser({ url, workspaceId });
      else setLinkUrl(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [directory, openBrowser, openSession, toast, workspaceId]);

  useEffect(() => {
    if (opened.current || !directory) return;
    opened.current = true;
    void open();
  }, [directory, open]);

  return (
    <View style={styles.screen}>
      <Icon name="SquareTerminal" size={28} color={theme.colors.foregroundMuted} />
      <Text style={styles.title}>Warp</Text>
      <Text style={styles.detail}>
        {openBrowser
          ? "Each Warp session opens in its own tab, in this workspace's folder."
          : "Warp opens in a browser tab on the machine running Paseo."}
      </Text>
      {directory ? <Text style={styles.path}>{directory}</Text> : null}
      {linkUrl ? <ExternalLink href={linkUrl}>Open Warp</ExternalLink> : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy || !directory}
        onPress={open}
        style={busy ? styles.buttonBusy : styles.button}
      >
        <Icon name="Plus" size={14} color={theme.colors.foreground} />
        <Text style={styles.buttonText}>{busy ? "Starting Warp…" : "New Warp session"}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(theme: Theme, compact: boolean) {
  const button = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  };
  return {
    screen: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 8,
      padding: compact ? 16 : 24,
      backgroundColor: theme.colors.surface0,
    },
    title: { color: theme.colors.foreground, fontSize: 16, fontWeight: "600" as const },
    detail: { color: theme.colors.foregroundMuted, textAlign: "center" as const },
    path: { color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: "monospace" },
    button,
    buttonBusy: { ...button, opacity: 0.6 },
    buttonText: { color: theme.colors.foreground },
  };
}
