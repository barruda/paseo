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
export function sortTreeEntries<T extends SortableEntry & { kind: "file" | "directory" }>(
  entries: readonly T[],
  sort: DocsSort,
): T[] {
  return [
    ...sortDocs(
      entries.filter((entry) => entry.kind === "directory"),
      sort,
    ),
    ...sortDocs(
      entries.filter((entry) => entry.kind === "file"),
      sort,
    ),
  ];
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
