// CUSTOM(desk-docs): copies the documents an agent mentions into the Docs tab, with their full
// paths, so the tab keeps them when the agent's tab is closed.
import { useEffect, useRef } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  classifyForResolution,
  type AssistantFileLinkSource,
} from "@/assistant-file-links/resolver";
import { useSessionStore } from "@/stores/session-store";
import { useSettings } from "@/hooks/use-settings";
import {
  captureDoc,
  fileNameOf,
  isDocPath,
  joinPath,
  parentPathOf,
  projectRefOf,
  type StatFile,
} from "./model";
import { useDeskDocsStore } from "./store";

interface MentionedLink {
  kind: "url" | "file";
  source: AssistantFileLinkSource;
}

const SETTLE_MS = 1_000;
const MAX_MISSING_ATTEMPTS = 3;

const newId = () => `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// One capture at a time across every open agent, so two sessions that mention the same file
// can't both add it.
let queue: Promise<void> = Promise.resolve();

export function createDirectoryStat(client: DaemonClient, cwd: string): StatFile {
  return async (path) => {
    try {
      const listing = await client.listDirectory(cwd, parentPathOf(path));
      const name = fileNameOf(path);
      const entry = listing.entries.find((item) => item.name === name && item.kind === "file");
      if (!entry) return null;
      const modifiedAt = Date.parse(entry.modifiedAt);
      return { modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : 0, size: entry.size };
    } catch {
      return null;
    }
  };
}

/** The absolute path a mentioned file points at, or null when it can't be told. */
export function mentionedDocPath(
  link: MentionedLink,
  context: { workspaceRoot: string; sessionPaths?: readonly string[] },
): string | null {
  if (link.kind !== "file") return null;
  const resolution = classifyForResolution(link.source, context);
  let path: string | null = null;
  if (resolution.kind === "resolved" && resolution.value.kind === "file") {
    path = resolution.value.target.path;
  } else if (resolution.kind === "needsLookup") {
    path = resolution.target.path;
  }
  if (!path || path.startsWith("~")) return null;
  const absolute = joinPath(context.workspaceRoot, path);
  return isDocPath(absolute) ? absolute : null;
}

async function captureOne(
  base: { serverId: string; projectRef: string; workspaceId: string },
  path: string,
  stat: StatFile,
): Promise<boolean> {
  for (;;) {
    const before = useDeskDocsStore.getState().docs;
    const next = await captureDoc(before, { ...base, path, newId }, stat);
    // The list may change while the daemon answers (a doc removed by hand): run it again.
    if (useDeskDocsStore.getState().docs !== before) continue;
    if (next !== before) useDeskDocsStore.getState().setDocs(next);
    return next.some((doc) => doc.path === path);
  }
}

async function captureAll(
  paths: string[],
  base: { serverId: string; projectRef: string; workspaceId: string },
  stat: StatFile,
  done: Map<string, number>,
): Promise<void> {
  for (const path of paths) {
    const found = await captureOne(base, path, stat);
    done.set(path, found ? MAX_MISSING_ATTEMPTS : (done.get(path) ?? 0) + 1);
  }
}

export function useDeskDocsCapture(input: {
  links: readonly MentionedLink[];
  client: DaemonClient | null;
  serverId: string;
  workspaceId: string | null;
  workspaceRoot: string;
  sessionPaths?: readonly string[];
}): void {
  const { links, client, serverId, workspaceId, workspaceRoot, sessionPaths } = input;
  const enabled = useSettings((settings) => settings.chatLinksEnabled);
  const projectId = useSessionStore((state) =>
    workspaceId ? (state.sessions[serverId]?.workspaces.get(workspaceId)?.projectId ?? null) : null,
  );
  // Paths this session already put through the check; a missing one gets a few more tries.
  const done = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled || !client || !workspaceId || !projectId || !workspaceRoot) return undefined;
    const paths = new Set<string>();
    for (const link of links) {
      const path = mentionedDocPath(link, { workspaceRoot, sessionPaths });
      if (path && (done.current.get(path) ?? 0) < MAX_MISSING_ATTEMPTS) paths.add(path);
    }
    if (paths.size === 0) return undefined;
    const timer = setTimeout(() => {
      const projectRef = projectRefOf(serverId, projectId);
      const stat = createDirectoryStat(client, workspaceRoot);
      const base = { serverId, projectRef, workspaceId };
      queue = queue.then(() => captureAll([...paths], base, stat, done.current));
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [enabled, client, links, projectId, serverId, sessionPaths, workspaceId, workspaceRoot]);
}
