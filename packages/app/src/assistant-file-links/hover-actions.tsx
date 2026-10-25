// CUSTOM(chat-file-actions): hovering a file link in the chat shows a card with its full path and
// icons for what to do with it: copy the full path and open it in a tab, for every file; for a
// `.sh`, run it here (as `!<command>`) or in a new Warp tab, in the script's own folder; for an
// `.html`, open it in the system browser; for anything else, show it in the system file manager.
// Web links get the same card: copy, open in a Paseo browser tab, open in the system browser. Web
// and desktop only: hover doesn't exist on native, where the link keeps opening on tap.
import * as Clipboard from "expo-clipboard";
import {
  Copy,
  ExternalLink,
  FolderOpen,
  Globe,
  Link,
  PanelTop,
  Play,
  SquareTerminal,
} from "lucide-react-native";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ToastApi } from "@/components/toast-host";
import { useChatCodeRun, useChatWorkspace, type ChatWorkspace } from "@/chat-code-run/context";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  useHoverCardClose,
} from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getIsElectron } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { useDesksStore } from "@/task-navigation/desks-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openExternalUrl } from "@/utils/open-external-url";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { pluginRegistry } from "@/plugins/registry";
import { resolveFullTabFilePath } from "@/screens/workspace/workspace-tab-menu-actions";
import { useTaskNavigationStore } from "@/task-navigation/store";
import type { Theme } from "@/styles/theme";
import { resolveBottomPanelWarpTarget } from "@/workspace-tabs/bottom-panel-default";
import { runInWarp } from "@/workspace-tabs/warp-run";
import type { InlinePathTarget } from "./parse";
import {
  useAssistantFileLinkResolverContext,
  type AssistantFileLinkResolverContextValue,
} from "./provider";
import type { AssistantFileLinkSource } from "./resolver";
import {
  fileLinkKind,
  joinFileLinkPath,
  scriptRunCommands,
  splitFileLinkPath,
} from "./hover-actions-model";

const OPEN_DELAY_MS = 200;
const ICON_SIZE = 14;
const MAX_CANDIDATES = 5;
// From the card's left edge to the middle of its first icon: card padding, button padding, half
// the icon. The card opens with that point right above the pointer.
const FIRST_ICON_CENTER = 8 + 4 + ICON_SIZE / 2;

const TRIGGER_STYLE: ViewStyle = {
  // RN doesn't type "inline-flex" but RN-web honors it, which keeps the link in the text's flow.
  display: "inline-flex" as ViewStyle["display"],
};

type Icon = ComponentType<{ size?: number; color?: string }>;
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const themed = (icon: Icon) => withUnistyles(icon, mutedColor);
const ThemedCopy = themed(Copy);
const ThemedPlay = themed(Play);
const ThemedWarp = themed(SquareTerminal);
const ThemedTab = themed(PanelTop);
const ThemedBrowser = themed(ExternalLink);
const ThemedFolder = themed(FolderOpen);
const ThemedLink = themed(Link);
const ThemedGlobe = themed(Globe);

// The card renders in a portal, outside the chat's providers, so the link reads them here and
// hands them down.
interface ChatContexts {
  resolver: AssistantFileLinkResolverContextValue;
  runHere: ReturnType<typeof useChatCodeRun>;
  workspace: ChatWorkspace | null;
  dispatcher: ReturnType<typeof useKeyboardActionDispatcher>;
  /** Every action closes the card: one that opens a tab hides the link, and the card would stay. */
  closeCard: () => void;
}

export function FileLinkHoverActions({
  source,
  target,
  lookupQuery,
  open,
  children,
}: {
  source: AssistantFileLinkSource;
  /** The resolved file; null while unresolved, and the card then waits for it. */
  target: InlinePathTarget | null;
  lookupQuery: string | null;
  open: (source: AssistantFileLinkSource, disposition: "preferred") => void;
  children: ReactNode;
}) {
  const resolver = useAssistantFileLinkResolverContext();
  const runHere = useChatCodeRun();
  const workspace = useChatWorkspace();
  const dispatcher = useKeyboardActionDispatcher();
  const chat = useMemo<Omit<ChatContexts, "closeCard">>(
    () => ({ resolver, runHere, workspace, dispatcher }),
    [resolver, runHere, workspace, dispatcher],
  );
  return (
    <HoverCard openDelayMs={OPEN_DELAY_MS}>
      <FileLinkHoverCardBody
        chat={chat}
        source={source}
        target={target}
        lookupQuery={lookupQuery}
        open={open}
      >
        {children}
      </FileLinkHoverCardBody>
    </HoverCard>
  );
}

// Under HoverCard, so it can read the card's close; the content below renders in a portal.
function FileLinkHoverCardBody({
  chat: chatWithoutClose,
  source,
  target,
  lookupQuery,
  open,
  children,
}: {
  chat: Omit<ChatContexts, "closeCard">;
  source: AssistantFileLinkSource;
  target: InlinePathTarget | null;
  lookupQuery: string | null;
  open: (source: AssistantFileLinkSource, disposition: "preferred") => void;
  children: ReactNode;
}) {
  const closeCard = useHoverCardClose();
  const chat = useMemo<ChatContexts>(
    () => ({ ...chatWithoutClose, closeCard }),
    [chatWithoutClose, closeCard],
  );
  return (
    <>
      <HoverCardTrigger style={TRIGGER_STYLE}>{children}</HoverCardTrigger>
      <HoverCardContent
        placement="top"
        alignment="start"
        offset={6}
        pointerAnchorOffset={FIRST_ICON_CENTER}
        style={styles.card}
        testID="file-link-hover-actions"
      >
        <FileLinkActionsCard
          chat={chat}
          source={source}
          target={target}
          lookupQuery={lookupQuery}
          open={open}
        />
      </HoverCardContent>
    </>
  );
}

function FileLinkActionsCard({
  chat,
  source,
  target,
  lookupQuery,
  open,
}: {
  chat: ChatContexts;
  source: AssistantFileLinkSource;
  target: InlinePathTarget | null;
  lookupQuery: string | null;
  open: (source: AssistantFileLinkSource, disposition: "preferred") => void;
}) {
  const { configRef, getDirectorySuggestions } = chat.resolver;
  const { workspaceRoot } = configRef.current;
  const path = target ? joinFileLinkPath(target.path, workspaceRoot) : null;
  const kind = path ? fileLinkKind(path) : null;

  // A script found by the daemon's suffix lookup may not be the only match. Running the wrong one
  // is worse than opening the wrong one, so the card lists every match to pick from. A plain
  // effect: the portal is outside the query client's provider too.
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const lookUpCandidates = kind === "script" && lookupQuery !== null && Boolean(workspaceRoot);
  useEffect(() => {
    if (!lookUpCandidates || !workspaceRoot || lookupQuery === null) return;
    let cancelled = false;
    void (async () => {
      const result = await getDirectorySuggestions({
        query: lookupQuery,
        cwd: workspaceRoot,
        includeFiles: true,
        includeDirectories: false,
        matchMode: "suffix",
        limit: MAX_CANDIDATES,
      }).catch(() => null);
      if (cancelled || !result) return;
      setCandidates(
        result.entries
          .filter((entry) => entry.kind === "file")
          .map((entry) => joinFileLinkPath(entry.path, workspaceRoot)),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [getDirectorySuggestions, lookUpCandidates, lookupQuery, workspaceRoot]);

  const openInTab = useCallback(() => open(source, "preferred"), [open, source]);

  if (!path || !kind) {
    return <Text style={styles.pending}>Procurando arquivo…</Text>;
  }

  const paths = kind === "script" && candidates && candidates.length > 1 ? candidates : [path];
  return (
    <View style={styles.rows}>
      {paths.length > 1 ? (
        <Text style={styles.pending}>{`${paths.length} arquivos com esse nome:`}</Text>
      ) : null}
      {paths.map((candidate) => (
        <FileLinkActionRow
          key={candidate}
          chat={chat}
          path={candidate}
          kind={kind}
          openInTab={openInTab}
        />
      ))}
    </View>
  );
}

function FileLinkActionRow({
  chat,
  path,
  kind,
  openInTab,
}: {
  chat: ChatContexts;
  path: string;
  kind: "script" | "html" | "other";
  openInTab: () => void;
}) {
  const { t } = useTranslation();
  const { runHere, workspace, dispatcher } = chat;
  const { serverId, workspaceRoot, toast } = chat.resolver.configRef.current;
  const tasksMode = useTaskNavigationStore((state) => state.enabled);
  const isLocalHost = useIsLocalDaemon(serverId ?? "");
  const openFile = isLocalHost ? getDesktopHost()?.opener?.openFile : undefined;
  const canRunInWarp = useMemo(
    () =>
      workspace !== null &&
      resolveBottomPanelWarpTarget({
        serverId: workspace.serverId,
        plugins: pluginRegistry.getSnapshot(),
        isElectron: getIsElectron(),
      }) !== null,
    [workspace],
  );

  // `~/…` paths only resolve on the host; everything else is already absolute here.
  const resolvePath = useCallback(async () => {
    if (!toast) return path.startsWith("~") ? null : path;
    return resolveFullTabFilePath({
      path,
      serverId,
      workspaceDirectory: workspaceRoot ?? null,
      toast,
      t,
    });
  }, [path, serverId, t, toast, workspaceRoot]);

  const copyPath = useCallback(async () => {
    const absolute = await resolvePath();
    if (!absolute) return;
    try {
      await Clipboard.setStringAsync(absolute);
      toast?.copied("Caminho completo");
    } catch {
      toast?.error(t("workspace.tabs.toasts.copyFailed"));
    }
  }, [resolvePath, t, toast]);

  const run = useCallback(
    async (where: "here" | "warp") => {
      const absolute = await resolvePath();
      if (!absolute) return;
      const { directory, name } = splitFileLinkPath(absolute);
      const commands = scriptRunCommands(directory, name);
      if (where === "here") {
        runHere?.(commands.here);
        return;
      }
      if (!workspace) return;
      const result = await runInWarp({
        target: { ...workspace, tasksMode },
        directory,
        command: commands.inFolder,
        createBottomPanel: () =>
          dispatcher.dispatch({ id: "workspace.bottom-panel.toggle", scope: "workspace" }),
      });
      if (result === "no-warp-tab") {
        toast?.error("Abra o Warp no painel inferior para executar nele");
      } else if (result === "timeout") {
        toast?.error("O Warp não abriu a tempo");
      }
    },
    [dispatcher, resolvePath, runHere, tasksMode, toast, workspace],
  );

  const runHereNow = useCallback(() => run("here"), [run]);
  const runInWarpNow = useCallback(() => run("warp"), [run]);

  const openExternally = useCallback(
    async (mode: "browser" | "reveal") => {
      const absolute = await resolvePath();
      if (!absolute || !openFile) return;
      try {
        await openFile({ path: absolute, mode });
      } catch (error) {
        toast?.error(error instanceof Error ? error.message : "Não foi possível abrir o arquivo");
      }
    },
    [openFile, resolvePath, toast],
  );
  const openInBrowser = useCallback(() => openExternally("browser"), [openExternally]);
  const revealInFolder = useCallback(() => openExternally("reveal"), [openExternally]);

  return (
    <View style={styles.row}>
      <View style={styles.actions}>
        <ActionButton
          label="Copiar caminho completo"
          closeCard={chat.closeCard}
          icon={ThemedCopy}
          onPress={copyPath}
        />
        {kind === "script" && runHere ? (
          <ActionButton
            label="Executar aqui"
            closeCard={chat.closeCard}
            icon={ThemedPlay}
            onPress={runHereNow}
          />
        ) : null}
        {kind === "script" && canRunInWarp ? (
          <ActionButton
            label="Executar no Warp"
            closeCard={chat.closeCard}
            icon={ThemedWarp}
            onPress={runInWarpNow}
          />
        ) : null}
        <ActionButton
          label="Abrir em aba"
          closeCard={chat.closeCard}
          icon={ThemedTab}
          onPress={openInTab}
        />
        {kind === "html" && openFile ? (
          <ActionButton
            label="Abrir no navegador"
            closeCard={chat.closeCard}
            icon={ThemedBrowser}
            onPress={openInBrowser}
          />
        ) : null}
        {kind === "other" && openFile ? (
          <ActionButton
            label="Abrir no gerenciador de arquivos"
            closeCard={chat.closeCard}
            icon={ThemedFolder}
            onPress={revealInFolder}
          />
        ) : null}
      </View>
      <Text selectable style={styles.path} numberOfLines={2}>
        {path}
      </Text>
    </View>
  );
}

function ActionButton({
  label,
  icon: IconComponent,
  onPress,
  closeCard,
}: {
  label: string;
  icon: Icon;
  onPress: () => void;
  closeCard: () => void;
}) {
  const handlePress = useCallback(() => {
    closeCard();
    onPress();
  }, [closeCard, onPress]);
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={handlePress}
          style={actionButtonStyle}
        >
          <IconComponent size={ICON_SIZE} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltip}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export function UrlHoverActions({ url, children }: { url: string; children: ReactNode }) {
  const { configRef } = useAssistantFileLinkResolverContext();
  const workspace = useChatWorkspace();
  return (
    <HoverCard openDelayMs={OPEN_DELAY_MS}>
      <UrlHoverCardBody url={url} workspace={workspace} toast={configRef.current.toast ?? null}>
        {children}
      </UrlHoverCardBody>
    </HoverCard>
  );
}

function UrlHoverCardBody({
  url,
  workspace,
  toast,
  children,
}: {
  url: string;
  workspace: ChatWorkspace | null;
  toast: ToastApi | null;
  children: ReactNode;
}) {
  const closeCard = useHoverCardClose();
  return (
    <>
      <HoverCardTrigger style={TRIGGER_STYLE}>{children}</HoverCardTrigger>
      <HoverCardContent
        placement="top"
        alignment="start"
        offset={6}
        pointerAnchorOffset={FIRST_ICON_CENTER}
        style={styles.card}
        testID="url-hover-actions"
      >
        <UrlActionRow url={url} workspace={workspace} toast={toast} closeCard={closeCard} />
      </HoverCardContent>
    </>
  );
}

function UrlActionRow({
  url,
  workspace,
  toast,
  closeCard,
}: {
  url: string;
  workspace: ChatWorkspace | null;
  toast: ToastApi | null;
  closeCard: () => void;
}) {
  const tasksMode = useTaskNavigationStore((state) => state.enabled);
  const copyUrl = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(url);
      toast?.copied("Link");
    } catch {
      toast?.error("Não foi possível copiar o link");
    }
  }, [toast, url]);
  // A browser tab of the chat's workspace, opened next to the chat like Ctrl+T's browser tabs.
  const openInTab = useCallback(() => {
    if (!workspace) return;
    const { browserId } = createWorkspaceBrowser({ initialUrl: url });
    const target = { kind: "browser" as const, browserId };
    if (tasksMode) {
      useDesksStore.getState().openTab({ ...workspace, target }, true);
      return;
    }
    const workspaceKey = buildWorkspaceTabPersistenceKey(workspace);
    if (workspaceKey)
      useWorkspaceLayoutStore.getState().openTab({ workspaceKey, target, intent: "reveal" });
  }, [tasksMode, url, workspace]);
  const openInBrowser = useCallback(() => {
    void openExternalUrl(url);
  }, [url]);

  return (
    <View style={styles.row}>
      <View style={styles.actions}>
        <ActionButton
          label="Copiar link"
          icon={ThemedLink}
          onPress={copyUrl}
          closeCard={closeCard}
        />
        {getIsElectron() && workspace ? (
          <ActionButton
            label="Abrir em aba"
            icon={ThemedTab}
            onPress={openInTab}
            closeCard={closeCard}
          />
        ) : null}
        <ActionButton
          label="Abrir no navegador"
          icon={ThemedGlobe}
          onPress={openInBrowser}
          closeCard={closeCard}
        />
      </View>
      <Text selectable style={styles.path} numberOfLines={2}>
        {url}
      </Text>
    </View>
  );
}

function actionButtonStyle({ hovered }: { hovered?: boolean }) {
  return [styles.button, hovered ? styles.buttonHovered : null];
}

const styles = StyleSheet.create((theme) => ({
  card: {
    maxWidth: 560,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  rows: {
    gap: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  path: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
  pending: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  button: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
  buttonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  tooltip: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
