// CUSTOM(explorer-folder-links): Files sidebar side of folder links. See ./folder-links.ts.
import { useEffect, useState, type RefObject } from "react";
import { FlatList, Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowLeft, Folder } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import type { ExpandedPathsUpdate } from "@/stores/panel-store";
import {
  explorerAncestorPaths,
  resolveFolderLinkTarget,
  useFolderLinkStore,
} from "@/file-explorer/folder-links";

const ThemedFolder = withUnistyles(Folder);
const ThemedArrowLeft = withUnistyles(ArrowLeft);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ESTIMATED_ROW_HEIGHT = 28;

/**
 * The temporary root the sidebar browses instead of the workspace, or null. Also routes folder
 * links clicked in chat: inside the workspace they become a reveal, outside a temporary root.
 */
export function useFolderLinkRoot(input: {
  workspaceStateKey: string | null;
  workspaceRoot: string;
}): { externalRoot: string | null; clearExternalRoot: () => void } {
  const { workspaceStateKey, workspaceRoot } = input;
  const request = useFolderLinkStore((state) =>
    workspaceStateKey ? state.requests[workspaceStateKey] : undefined,
  );
  const externalRoot = useFolderLinkStore((state) =>
    workspaceStateKey ? (state.externalRoots[workspaceStateKey] ?? null) : null,
  );

  useEffect(() => {
    if (!request || !workspaceStateKey) return;
    const store = useFolderLinkStore.getState();
    store.takeRequest(workspaceStateKey, request.nonce);
    const target = resolveFolderLinkTarget({ workspaceRoot, absolutePath: request.path });
    if (target.kind === "external") {
      store.setExternalRoot(workspaceStateKey, target.root);
      return;
    }
    store.setExternalRoot(workspaceStateKey, null);
    store.requestReveal(workspaceStateKey, target.relativePath);
  }, [request, workspaceRoot, workspaceStateKey]);

  return {
    externalRoot,
    clearExternalRoot: () => {
      if (workspaceStateKey) useFolderLinkStore.getState().setExternalRoot(workspaceStateKey, null);
    },
  };
}

interface RevealableRow {
  type: string;
  row?: { entry: { path: string } };
}

/** Expands, selects, and scrolls to a folder a chat link asked the tree to reveal. */
export function useFolderLinkReveal<Row extends RevealableRow>(input: {
  workspaceStateKey: string | null;
  listRows: Row[];
  treeListRef: RefObject<FlatList<Row> | null>;
  requestDirectoryListing: (
    path: string,
    options: { recordHistory: boolean; setCurrentPath: boolean },
  ) => Promise<unknown>;
  setExpandedPathsForWorkspace: (key: string, update: ExpandedPathsUpdate) => void;
  selectExplorerEntry: (path: string | null) => void;
}): void {
  const {
    workspaceStateKey,
    listRows,
    treeListRef,
    requestDirectoryListing,
    setExpandedPathsForWorkspace,
    selectExplorerEntry,
  } = input;
  const reveal = useFolderLinkStore((state) =>
    workspaceStateKey ? state.reveals[workspaceStateKey] : undefined,
  );
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!reveal || !workspaceStateKey) return;
    useFolderLinkStore.getState().takeReveal(workspaceStateKey, reveal.nonce);
    const ancestors = explorerAncestorPaths(reveal.path);
    setExpandedPathsForWorkspace(workspaceStateKey, (current) => {
      const next = new Set([".", ...current, ...ancestors]);
      return [...next];
    });
    void (async () => {
      for (const path of [".", ...ancestors]) {
        await requestDirectoryListing(path, { recordHistory: false, setCurrentPath: false });
      }
      if (reveal.path !== ".") {
        selectExplorerEntry(reveal.path);
        setScrollTarget(reveal.path);
      }
    })();
  }, [
    requestDirectoryListing,
    reveal,
    selectExplorerEntry,
    setExpandedPathsForWorkspace,
    workspaceStateKey,
  ]);

  useEffect(() => {
    if (!scrollTarget) return;
    const index = listRows.findIndex(
      (row) => row.type === "entry" && row.row?.entry.path === scrollTarget,
    );
    if (index < 0) return;
    setScrollTarget(null);
    const list = treeListRef.current;
    if (!list) return;
    try {
      list.scrollToIndex({ index, viewPosition: 0.3, animated: true });
    } catch {
      // Rows past the rendered window have no measured layout yet.
      list.scrollToOffset({ offset: index * ESTIMATED_ROW_HEIGHT, animated: true });
    }
  }, [listRows, scrollTarget, treeListRef]);
}

function backButtonStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.backButton, hovered && styles.backButtonHovered];
}

export function ExternalFolderBar({ root, onBack }: { root: string; onBack: () => void }) {
  return (
    <View style={styles.bar} testID="files-external-root-bar">
      <ThemedFolder size={14} uniProps={mutedColor} />
      <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
        {root}
      </Text>
      <Pressable
        onPress={onBack}
        style={backButtonStyle}
        accessibilityRole="button"
        accessibilityLabel="Back to workspace"
        testID="files-external-root-back"
      >
        <ThemedArrowLeft size={12} uniProps={mutedColor} />
        <Text style={styles.backText}>Workspace</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  path: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    height: 24,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  backButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  backText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
