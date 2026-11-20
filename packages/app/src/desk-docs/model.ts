// CUSTOM(desk-docs): the Docs tab beside the Desks. See custom/CHANGES.md.

export type DocsSort = "recent" | "name";

/** A document the agents mentioned, kept by its full path so the tab never reads an agent's chat. */
export interface DocEntry {
  id: string;
  serverId: string;
  /** `serverId:projectId` of the project the mentioning session belonged to. */
  projectRef: string;
  /** The session's workspace; where the document opens while that workspace still exists. */
  workspaceId: string;
  name: string;
  /** Absolute path on the host. */
  path: string;
  /** The file's modification time, in ms. */
  modifiedAt: number;
}

/** A folder the user added to a project; shown as a collapsible tree. */
export interface DocRoot {
  id: string;
  serverId: string;
  projectRef: string;
  /** Absolute path on the host. */
  path: string;
}

export interface DocStat {
  modifiedAt: number;
  size: number;
}

/** `null` when the path is not a file that exists. */
export type StatFile = (path: string) => Promise<DocStat | null>;

// Only documents worth reopening: reports and notes, never source files.
const DOC_PATH = /(?:^|\/)[^/.][^/]*\.(?:html?|md|markdown)$/i;

export function isDocPath(path: string): boolean {
  return DOC_PATH.test(path);
}

export function projectRefOf(serverId: string, projectId: string): string {
  return `${serverId}:${projectId}`;
}

export function fileNameOf(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

export function parentPathOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash <= 0 ? "/" : trimmed.slice(0, slash);
}

export function joinPath(base: string, relative: string): string {
  if (relative.startsWith("/")) return relative;
  const root = base.replace(/\/+$/, "");
  const rest = relative.replace(/^\.\//, "");
  return `${root}/${rest}`;
}

export interface CaptureInput {
  serverId: string;
  projectRef: string;
  workspaceId: string;
  /** Absolute path with no line suffix. */
  path: string;
  newId: () => string;
}

/**
 * Adds a mentioned document to the project's list, or returns `entries` itself when nothing changes.
 *  - Not a file that exists: ignored.
 *  - Same path as an entry: the same document, kept (its time is refreshed).
 *  - Same name, other path, and the old path is gone: the document moved, so the entry follows it.
 *  - Same name, other path, and the old path still exists: another document that shares the name.
 */
export async function captureDoc(
  entries: DocEntry[],
  input: CaptureInput,
  stat: StatFile,
): Promise<DocEntry[]> {
  if (!isDocPath(input.path)) return entries;
  const found = await stat(input.path);
  if (!found) return entries;
  const inProject = (entry: DocEntry) =>
    entry.serverId === input.serverId && entry.projectRef === input.projectRef;
  const same = entries.find((entry) => inProject(entry) && entry.path === input.path);
  if (same) {
    if (same.modifiedAt === found.modifiedAt) return entries;
    return entries.map((entry) =>
      entry === same ? { ...entry, modifiedAt: found.modifiedAt } : entry,
    );
  }
  const name = fileNameOf(input.path);
  for (const candidate of entries) {
    if (!inProject(candidate) || candidate.name !== name) continue;
    if (await stat(candidate.path)) continue;
    return entries.map((entry) =>
      entry === candidate
        ? {
            ...entry,
            path: input.path,
            workspaceId: input.workspaceId,
            modifiedAt: found.modifiedAt,
          }
        : entry,
    );
  }
  return [
    ...entries,
    {
      id: input.newId(),
      serverId: input.serverId,
      projectRef: input.projectRef,
      workspaceId: input.workspaceId,
      name,
      path: input.path,
      modifiedAt: found.modifiedAt,
    },
  ];
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export interface SortableEntry {
  name: string;
  modifiedAt: number;
}

/** Newest first, or A to Z. Ties fall back to the name so the order never flickers. */
export function sortDocs<T extends SortableEntry>(entries: readonly T[], sort: DocsSort): T[] {
  return [...entries].sort((a, b) =>
    sort === "recent"
      ? b.modifiedAt - a.modifiedAt || compareNames(a.name, b.name)
      : compareNames(a.name, b.name),
  );
}

/** Folders always come before files; each group follows the sort. */
export function sortTreeEntries<T extends SortableEntry & { kind: string }>(
  entries: readonly T[],
  sort: DocsSort,
): T[] {
  return [
    ...sortDocs(
      entries.filter((entry) => entry.kind !== "file"),
      sort,
    ),
    ...sortDocs(
      entries.filter((entry) => entry.kind === "file"),
      sort,
    ),
  ];
}

/** A file in the Docs tree; `doc` is the captured entry the row opens. */
export interface DocTreeFile {
  kind: "file";
  name: string;
  /** Absolute path on the host. */
  path: string;
  modifiedAt: number;
  doc: DocEntry;
}

/** A folder in the Docs tree, possibly several single-child folders folded into one row. */
export interface DocTreeFolder {
  kind: "folder";
  /** "a/b/c" when single-child folders were folded into this row. */
  name: string;
  /** Absolute path of the innermost folder the row stands for. */
  path: string;
  /** The newest document under the folder. */
  modifiedAt: number;
  /** Documents under the folder. */
  count: number;
  children: DocTreeNode[];
}

export type DocTreeNode = DocTreeFile | DocTreeFolder;

/** A document placed in a tree: the folder the relative segments start from. */
export interface PlacedDoc {
  doc: DocEntry;
  /** Absolute folder the segments are relative to. */
  base: string;
  segments: string[];
}

export interface DocsTreeGroup {
  /** Absolute folder the tree is relative to; empty for the project's own documents. */
  root: string;
  /** Short label ("memory", "tmp", "~/.claude"), or null for the project's own documents. */
  label: string | null;
  nodes: DocTreeNode[];
  count: number;
  modifiedAt: number;
}

export interface ProjectDocsTree {
  /** Documents under one of the project's workspaces. */
  project: DocsTreeGroup | null;
  /** Documents outside every workspace, one group per root. */
  external: DocsTreeGroup[];
}

/** Above this many documents a project's folders start closed, so the section stays scannable. */
export const FOLDER_DEFAULT_CLOSED_ABOVE = 15;

export function defaultFolderExpanded(docCount: number): boolean {
  return docCount <= FOLDER_DEFAULT_CLOSED_ABOVE;
}

/** The persisted state key of one folder; a path can repeat across projects and hosts. */
export function folderKey(projectRef: string, path: string): string {
  return `${projectRef}|${path}`;
}

export function isFolderExpanded(
  overrides: Readonly<Record<string, boolean>>,
  key: string,
  fallback: boolean,
): boolean {
  return overrides[key] ?? fallback;
}

/** The segments of `path` under `base`, or null when `path` is not inside `base`. */
export function relativeSegments(path: string, base: string): string[] | null {
  const root = base.replace(/\/+$/, "");
  if (path === root) return [];
  const prefix = root === "/" ? "/" : `${root}/`;
  if (!path.startsWith(prefix)) return null;
  return path
    .slice(prefix.length)
    .split("/")
    .filter((segment) => segment.length > 0);
}

/** The workspace directory that holds `path`, preferring the deepest one. */
export function workspaceHolding(path: string, directories: readonly string[]): string | null {
  let holding: string | null = null;
  for (const directory of directories) {
    const root = directory.replace(/\/+$/, "");
    if (!root) continue;
    if (path === root || path.startsWith(`${root}/`)) {
      if (!holding || root.length > holding.length) holding = root;
    }
  }
  return holding;
}

const HOME_PREFIX = /^\/(?:Users|home)\/[^/]+/;

function joinAbsolute(base: string, segments: readonly string[]): string {
  return `${base}/${segments.join("/")}`;
}

/**
 * The folder an outside document is grouped under, with a label short enough for the tree:
 * the agent's `memory` folder, a dot folder under home (`~/.claude`), or the first two folders
 * under home (`~/uprojects/tmp` → "tmp"). A document directly in home gets "~".
 */
export function externalRootOf(path: string): { root: string; label: string } {
  const home = HOME_PREFIX.exec(path)?.[0] ?? "";
  const rest = (home ? path.slice(home.length) : path).replace(/^\/+/, "");
  const segments = rest.split("/").filter((segment) => segment.length > 0);
  const directories = segments.slice(0, -1);
  const memoryAt = directories.indexOf("memory");
  if (memoryAt >= 0) {
    return { root: joinAbsolute(home, directories.slice(0, memoryAt + 1)), label: "memory" };
  }
  const first = directories[0];
  if (first?.startsWith(".")) {
    return { root: joinAbsolute(home, [first]), label: `~/${first}` };
  }
  if (directories.length >= 2) {
    return {
      root: joinAbsolute(home, directories.slice(0, 2)),
      label: directories[1],
    };
  }
  if (first) return { root: joinAbsolute(home, [first]), label: first };
  return { root: home || "/", label: home ? "~" : "/" };
}

interface RawFolder {
  name: string;
  path: string;
  folders: Map<string, RawFolder>;
  files: DocTreeFile[];
}

function countFiles(nodes: readonly DocTreeNode[]): number {
  return nodes.reduce((total, node) => total + (node.kind === "file" ? 1 : node.count), 0);
}

function newestOf(nodes: readonly DocTreeNode[]): number {
  return nodes.reduce((newest, node) => Math.max(newest, node.modifiedAt), 0);
}

/**
 * Folds a chain of folders that each hold a single folder into one row (`a/b/c`), the way VS
 * Code does. A folder whose only child is a file is not folded, so the row is never a file.
 */
function compactFolder(folder: RawFolder, sort: DocsSort): DocTreeFolder {
  let current = folder;
  let name = folder.name;
  while (current.files.length === 0 && current.folders.size === 1) {
    const child = current.folders.values().next().value!;
    name = `${name}/${child.name}`;
    current = child;
  }
  const children = nodesOf(current, sort);
  return {
    kind: "folder",
    name,
    path: current.path,
    modifiedAt: newestOf(children),
    count: countFiles(children),
    children,
  };
}

function nodesOf(folder: RawFolder, sort: DocsSort): DocTreeNode[] {
  const folders = [...folder.folders.values()].map((child) => compactFolder(child, sort));
  return sortTreeEntries([...folders, ...folder.files], sort);
}

/** Builds one project's tree from documents already placed under their root folder. */
export function buildDocsTree(placed: readonly PlacedDoc[], sort: DocsSort): DocTreeNode[] {
  const root: RawFolder = { name: "", path: "", folders: new Map(), files: [] };
  for (const item of placed) {
    if (item.segments.length === 0) continue;
    let folder = root;
    for (let index = 0; index < item.segments.length - 1; index++) {
      const segments = item.segments.slice(0, index + 1);
      const path = joinPath(item.base, segments.join("/"));
      let child = folder.folders.get(path);
      if (!child) {
        child = { name: item.segments[index], path, folders: new Map(), files: [] };
        folder.folders.set(path, child);
      }
      folder = child;
    }
    folder.files.push({
      kind: "file",
      name: item.segments[item.segments.length - 1],
      path: item.doc.path,
      modifiedAt: item.doc.modifiedAt,
      doc: item.doc,
    });
  }
  return nodesOf(root, sort);
}

function groupOf(root: string, label: string | null, nodes: DocTreeNode[]): DocsTreeGroup {
  return { root, label, nodes, count: countFiles(nodes), modifiedAt: newestOf(nodes) };
}

/**
 * Splits a project's documents into the ones under its workspaces and one group per external
 * root, then builds a sorted tree for each.
 */
export function buildProjectDocsTree(
  docs: readonly DocEntry[],
  workspaceDirectories: readonly string[],
  sort: DocsSort,
): ProjectDocsTree {
  const inProject: PlacedDoc[] = [];
  const external = new Map<string, { label: string; placed: PlacedDoc[] }>();
  for (const doc of docs) {
    const base = workspaceHolding(doc.path, workspaceDirectories);
    if (base) {
      const segments = relativeSegments(doc.path, base);
      if (segments && segments.length > 0) inProject.push({ doc, base, segments });
      continue;
    }
    const root = externalRootOf(doc.path);
    const segments = relativeSegments(doc.path, root.root);
    if (!segments || segments.length === 0) continue;
    const group = external.get(root.root) ?? { label: root.label, placed: [] };
    group.placed.push({ doc, base: root.root, segments });
    external.set(root.root, group);
  }
  const project = inProject.length > 0 ? groupOf("", null, buildDocsTree(inProject, sort)) : null;
  const groups = [...external.entries()].map(([root, group]) =>
    groupOf(root, group.label, buildDocsTree(group.placed, sort)),
  );
  groups.sort((a, b) =>
    sort === "recent"
      ? b.modifiedAt - a.modifiedAt || compareNames(a.label ?? "", b.label ?? "")
      : compareNames(a.label ?? "", b.label ?? ""),
  );
  return { project, external: groups };
}

/**
 * The projects the filter shows: every project but the hidden ones. The store keeps the hidden
 * refs, so a project the list has never seen stays visible without being added anywhere.
 */
export function visibleProjects<T extends { ref: string }>(
  projects: readonly T[],
  hiddenRefs: readonly string[],
): T[] {
  if (hiddenRefs.length === 0) return [...projects];
  const hidden = new Set(hiddenRefs);
  return projects.filter((project) => !hidden.has(project.ref));
}

/** The filter trigger's label: everything, how many, or none. */
export function projectFilterLabel(total: number, visible: number): string {
  if (visible === 0) return "No projects";
  if (visible === total) return "All projects";
  return `${visible} project${visible === 1 ? "" : "s"}`;
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/** The Desk the Docs tab prefers: "Navegadores" (or "Navegador"), whatever the case or accents. */
export function findBrowsersDesk(desks: readonly { id: string; name: string }[]): string | null {
  const match = desks.find((desk) => {
    const name = normalizeName(desk.name);
    return name === "navegadores" || name === "navegador";
  });
  return match?.id ?? null;
}
