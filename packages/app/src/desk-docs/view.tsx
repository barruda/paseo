// CUSTOM(desk-docs): the Docs tab. See custom/CHANGES.md.
import { memo, useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useFetchQuery } from "@/data/query";
import * as Clipboard from "expo-clipboard";
import { ChevronDown, Folder, FolderOpen, Plus } from "lucide-react-native";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { PressHighlight } from "@/components/ui/press-highlight";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TreeChevron,
  WORKSPACE_TREE_ICON_SIZE,
  treeRowPaddingLeft,
} from "@/components/tree-primitives";
import { buttonControlHeight } from "@/components/ui/control-geometry";
import { useToast } from "@/contexts/toast-context";
import { pickDirectory } from "@/desktop/pick-directory";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useWorkspaceProjectTabIcon } from "@/panels/agent-project-tab-icon";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  fileNameOf,
  joinPath,
  parentPathOf,
  sortDocs,
  sortTreeEntries,
  type DocEntry,
  type DocRoot,
  type DocsSort,
} from "./model";
import { openDocument } from "./open";
import { pickOwnerWorkspace, useDocsProjects, type DocsProject } from "./projects";
import { useDeskDocsStore } from "./store";

const SORT_LABELS: Record<DocsSort, string> = { recent: "Most recent", name: "A to Z" };

const ThemedChevronDown = withUnistyles(ChevronDown, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedPlus = withUnistyles(Plus, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedFolder = withUnistyles(Folder, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedFolderOpen = withUnistyles(FolderOpen, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const newId = () => `root-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function DeskDocsView() {
  const projects = useDocsProjects();
  const docs = useDeskDocsStore((s) => s.docs);
  const roots = useDeskDocsStore((s) => s.roots);
  const sort = useDeskDocsStore((s) => s.sort);
  const ordered = useMemo(() => {
    const hasContent = (project: DocsProject) =>
      docs.some((doc) => doc.projectRef === project.ref) ||
      roots.some((root) => root.projectRef === project.ref);
    return [...projects].sort(
      (a, b) =>
        Number(hasContent(b)) - Number(hasContent(a)) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }, [projects, docs, roots]);
  return (
    <View style={styles.root} testID="desk-docs">
      <View style={styles.toolbar}>
        <SortMenu sort={sort} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {ordered.length === 0 ? (
          <Text style={styles.empty}>No projects yet.</Text>
        ) : (
          ordered.map((project) => (
            <ProjectSection
              key={project.ref}
              project={project}
              docs={docs}
              roots={roots}
              sort={sort}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function SortMenu({ sort }: { sort: DocsSort }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID="desk-docs-sort"
        accessibilityRole="button"
        accessibilityLabel={`Sort: ${SORT_LABELS[sort]}`}
        style={styles.sortTrigger}
      >
        <Text style={styles.sortLabel}>{SORT_LABELS[sort]}</Text>
        <ThemedChevronDown size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" width={180} testID="desk-docs-sort-menu">
        {(Object.keys(SORT_LABELS) as DocsSort[]).map((value) => (
          <SortItem key={value} value={value} selected={value === sort} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortItem({ value, selected }: { value: DocsSort; selected: boolean }) {
  const choose = useCallback(() => useDeskDocsStore.getState().setSort(value), [value]);
  return (
    <DropdownMenuItem testID={`desk-docs-sort-${value}`} selected={selected} onSelect={choose}>
      {SORT_LABELS[value]}
    </DropdownMenuItem>
  );
}

const ProjectSection = memo(function ProjectSection({
  project,
  docs,
  roots,
  sort,
}: {
  project: DocsProject;
  docs: DocEntry[];
  roots: DocRoot[];
  sort: DocsSort;
}) {
  const toast = useToast();
  const collapsed = useDeskDocsStore((s) => s.collapsedProjects.includes(project.ref));
  const isLocal = useIsLocalDaemon(project.serverId);
  const Icon = useWorkspaceProjectTabIcon(project.serverId, project.workspaces[0]?.id ?? null);
  const projectDocs = useMemo(
    () =>
      sortDocs(
        docs.filter((doc) => doc.projectRef === project.ref),
        sort,
      ),
    [docs, project.ref, sort],
  );
  const projectRoots = useMemo(
    () => roots.filter((root) => root.projectRef === project.ref),
    [roots, project.ref],
  );
  const toggle = useCallback(
    () => useDeskDocsStore.getState().toggleProject(project.ref),
    [project.ref],
  );
  const addFolder = useCallback(async () => {
    if (!isLocal) {
      toast.error("Adding a folder needs a project on this computer's daemon");
      return;
    }
    try {
      const path = await pickDirectory();
      if (path) {
        useDeskDocsStore
          .getState()
          .addRoot({ id: newId(), serverId: project.serverId, projectRef: project.ref, path });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the folder picker");
    }
  }, [isLocal, project.ref, project.serverId, toast]);
  const count = projectDocs.length + projectRoots.length;
  return (
    <View style={styles.section} testID={`desk-docs-project-${project.ref}`}>
      <View style={styles.sectionHeader}>
        <PressHighlight
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={project.name}
          style={styles.sectionTitle}
        >
          <TreeChevron expanded={!collapsed} />
          {Icon ? <Icon size={16} color="currentColor" /> : null}
          <Text style={styles.sectionName} numberOfLines={1}>
            {project.name}
          </Text>
          {count > 0 ? <Text style={styles.sectionCount}>{count}</Text> : null}
        </PressHighlight>
        <ToolbarButton
          label="Add folder"
          onPress={addFolder}
          style={styles.addButton}
          testID={`desk-docs-add-${project.ref}`}
        >
          <ThemedPlus size={14} />
        </ToolbarButton>
      </View>
      {collapsed ? null : (
        <View>
          {/* Folders come before files. */}
          {projectRoots.map((root) => (
            <RootTree key={root.id} root={root} project={project} sort={sort} />
          ))}
          {projectDocs.map((doc) => (
            <DocRow key={doc.id} doc={doc} project={project} />
          ))}
        </View>
      )}
    </View>
  );
});

function openPath(project: DocsProject, path: string, preferredWorkspaceId?: string) {
  const owner = pickOwnerWorkspace(project, path, preferredWorkspaceId);
  if (!owner) return;
  openDocument({ serverId: project.serverId, workspaceId: owner.id, path });
}

const DocRow = memo(function DocRow({ doc, project }: { doc: DocEntry; project: DocsProject }) {
  const toast = useToast();
  const [hovered, setHovered] = useState(false);
  const open = useCallback(
    () => openPath(project, doc.path, doc.workspaceId),
    [project, doc.path, doc.workspaceId],
  );
  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(doc.path);
    toast.show("Path copied");
  }, [doc.path, toast]);
  const remove = useCallback(() => useDeskDocsStore.getState().removeDoc(doc.id), [doc.id]);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const rowStyle = useMemo(() => [styles.row, hovered && styles.rowHovered], [hovered]);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        onPress={open}
        onHoverIn={hoverIn}
        onHoverOut={hoverOut}
        style={rowStyle}
        accessibilityLabel={doc.path}
        testID={`desk-docs-doc-${doc.id}`}
      >
        <View style={styles.rowIcon}>
          <MaterialFileIcon fileName={doc.name} size={WORKSPACE_TREE_ICON_SIZE} />
        </View>
        <Text style={styles.rowName} numberOfLines={1}>
          {doc.name}
        </Text>
        <Text style={styles.rowDetail} numberOfLines={1}>
          {fileNameOf(parentPathOf(doc.path))}
        </Text>
      </ContextMenuTrigger>
      <ContextMenuContent align="start">
        <ContextMenuItem onSelect={open}>Open</ContextMenuItem>
        <ContextMenuItem onSelect={copy}>Copy full path</ContextMenuItem>
        <ContextMenuItem destructive onSelect={remove}>
          Remove from Docs
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

function RootTree({
  root,
  project,
  sort,
}: {
  root: DocRoot;
  project: DocsProject;
  sort: DocsSort;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const remove = useCallback(() => useDeskDocsStore.getState().removeRoot(root.id), [root.id]);
  const cwd = project.workspaces[0]?.directory ?? root.path;
  return (
    <View>
      <ContextMenu>
        <ContextMenuTrigger
          onPress={toggle}
          style={styles.row}
          accessibilityLabel={root.path}
          testID={`desk-docs-root-${root.id}`}
        >
          <TreeChevron expanded={expanded} />
          <Text style={styles.rowName} numberOfLines={1}>
            {fileNameOf(root.path)}
          </Text>
          <Text style={styles.rowDetail} numberOfLines={1}>
            {parentPathOf(root.path)}
          </Text>
        </ContextMenuTrigger>
        <ContextMenuContent align="start">
          <ContextMenuItem destructive onSelect={remove}>
            Remove folder from Docs
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {expanded ? (
        <DirectoryChildren
          serverId={root.serverId}
          cwd={cwd}
          path={root.path}
          depth={1}
          sort={sort}
          project={project}
        />
      ) : null}
    </View>
  );
}

interface ListedEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  modifiedAt: number;
}

function DirectoryChildren({
  serverId,
  cwd,
  path,
  depth,
  sort,
  project,
}: {
  serverId: string;
  cwd: string;
  path: string;
  depth: number;
  sort: DocsSort;
  project: DocsProject;
}) {
  const client = useHostRuntimeClient(serverId);
  const query = useFetchQuery({
    queryKey: ["desk-docs-directory", serverId, path],
    enabled: client !== null,
    dataShape: "list",
    staleTimeMs: 10_000,
    queryFn: async () => {
      const listing = await client!.listDirectory(cwd, path);
      return listing.entries.map<ListedEntry>((entry) => ({
        name: entry.name,
        path: joinPath(cwd, entry.path),
        kind: entry.kind,
        modifiedAt: Date.parse(entry.modifiedAt) || 0,
      }));
    },
  });
  const entries = useMemo(() => sortTreeEntries(query.data ?? [], sort), [query.data, sort]);
  if (query.isError) {
    return (
      <Text style={[styles.note, { paddingLeft: treeRowPaddingLeft(depth) }]}>
        Could not read this folder.
      </Text>
    );
  }
  if (query.isPending) {
    return <Text style={[styles.note, { paddingLeft: treeRowPaddingLeft(depth) }]}>Loading…</Text>;
  }
  if (entries.length === 0) {
    return <Text style={[styles.note, { paddingLeft: treeRowPaddingLeft(depth) }]}>Empty</Text>;
  }
  return (
    <View>
      {entries.map((entry) =>
        entry.kind === "directory" ? (
          <DirectoryNode
            key={entry.path}
            entry={entry}
            serverId={serverId}
            cwd={cwd}
            depth={depth}
            sort={sort}
            project={project}
          />
        ) : (
          <FileNode key={entry.path} entry={entry} depth={depth} project={project} />
        ),
      )}
    </View>
  );
}

function DirectoryNode({
  entry,
  serverId,
  cwd,
  depth,
  sort,
  project,
}: {
  entry: ListedEntry;
  serverId: string;
  cwd: string;
  depth: number;
  sort: DocsSort;
  project: DocsProject;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const rowStyle = useMemo(() => [styles.row, { paddingLeft: treeRowPaddingLeft(depth) }], [depth]);
  return (
    <View>
      <PressHighlight
        onPress={toggle}
        style={rowStyle}
        accessibilityLabel={entry.path}
        testID={`desk-docs-dir-${entry.path}`}
      >
        <TreeChevron expanded={expanded} />
        {expanded ? <ThemedFolderOpen size={14} /> : <ThemedFolder size={14} />}
        <Text style={styles.rowName} numberOfLines={1}>
          {entry.name}
        </Text>
      </PressHighlight>
      {expanded ? (
        <DirectoryChildren
          serverId={serverId}
          cwd={cwd}
          path={entry.path}
          depth={depth + 1}
          sort={sort}
          project={project}
        />
      ) : null}
    </View>
  );
}

function FileNode({
  entry,
  depth,
  project,
}: {
  entry: ListedEntry;
  depth: number;
  project: DocsProject;
}) {
  const open = useCallback(() => openPath(project, entry.path), [project, entry.path]);
  const rowStyle = useMemo(
    () => [styles.row, { paddingLeft: treeRowPaddingLeft(depth) + WORKSPACE_TREE_ICON_SIZE }],
    [depth],
  );
  return (
    <PressHighlight
      onPress={open}
      style={rowStyle}
      accessibilityLabel={entry.path}
      testID={`desk-docs-file-${entry.path}`}
    >
      <MaterialFileIcon fileName={entry.name} size={WORKSPACE_TREE_ICON_SIZE} />
      <Text style={styles.rowName} numberOfLines={1}>
        {entry.name}
      </Text>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: theme.spacing[3],
    height: 36,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  sortTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    height: buttonControlHeight.xs,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  sortLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  scroll: { flex: 1 },
  scrollContent: { paddingVertical: theme.spacing[2] },
  empty: { color: theme.colors.foregroundMuted, padding: theme.spacing[4] },
  section: { marginBottom: theme.spacing[2] },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[3],
    height: 32,
  },
  sectionTitle: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    height: "100%",
  },
  sectionName: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  sectionCount: { color: theme.colors.foregroundExtraMuted, fontSize: theme.fontSize.sm },
  // A discreet outline, so the + reads as a button without competing with the project name.
  addButton: {
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.base,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    height: 28,
    paddingLeft: treeRowPaddingLeft(1),
    paddingRight: theme.spacing[3],
  },
  rowHovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  rowIcon: { width: WORKSPACE_TREE_ICON_SIZE, height: WORKSPACE_TREE_ICON_SIZE },
  rowName: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  rowDetail: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  note: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, paddingVertical: 4 },
}));
