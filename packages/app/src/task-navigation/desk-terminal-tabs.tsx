// CUSTOM(desk-dead-terminals): Desks persist their tabs locally, but terminals live only as long as
// the daemon runs them. The workspace screen closes tabs of terminals that are gone; this does the
// same for Desks, so a reboot or an exited shell doesn't leave a blank terminal tab behind.
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useReplicaQuery } from "@/data/query";
import { workspaceTerminalsPushRoute } from "@/data/push-router";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { buildTerminalsQueryKey } from "@/screens/workspace/terminals/state";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { deskTabs, useDesksStore, type DeskTabOwner } from "./desks-store";

const OWNER_SEPARATOR = "\u0000";

/** The workspaces that own a terminal tab in any Desk, as one string so the selector stays stable. */
function terminalOwnerKeys(state: ReturnType<typeof useDesksStore.getState>): string {
  const keys = new Set<string>();
  for (const desk of state.desks) {
    for (const tab of deskTabs(desk)) {
      if (tab.target.kind === "terminal") {
        keys.add(`${tab.serverId}${OWNER_SEPARATOR}${tab.workspaceId}`);
      }
    }
  }
  return [...keys].sort().join("\n");
}

export function DeskTerminalTabs() {
  const ownerKeys = useDesksStore(terminalOwnerKeys);
  const owners = useMemo(
    () =>
      ownerKeys
        ? ownerKeys.split("\n").map((key) => {
            const [serverId = "", workspaceId = ""] = key.split(OWNER_SEPARATOR);
            return { key, serverId, workspaceId };
          })
        : [],
    [ownerKeys],
  );
  return (
    <>
      {owners.map((owner) => (
        <WorkspaceTerminalTabs key={owner.key} owner={owner} />
      ))}
    </>
  );
}

function WorkspaceTerminalTabs({ owner }: { owner: DeskTabOwner }) {
  const { serverId, workspaceId } = owner;
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const directory = useWorkspaceDirectory(serverId, workspaceId);
  const enabled = Boolean(client && isConnected && directory);
  const query = useReplicaQuery({
    queryKey: buildTerminalsQueryKey(serverId, directory, workspaceId),
    enabled,
    pushEvent: "terminals_changed",
    meta: workspaceTerminalsPushRoute({ enabled, serverId, cwd: directory ?? "", workspaceId }),
    queryFn: async () => {
      if (!client || !directory) throw new Error(t("workspace.terminal.hostDisconnected"));
      return await client.listTerminals(directory, undefined, { workspaceId });
    },
  });
  // A list cached before this mounted can predate a tab that was just opened (a script's
  // terminal), so only lists fetched or pushed from here on close tabs.
  const mountedAt = useRef(Date.now());
  const { refetch, isSuccess, data, dataUpdatedAt } = query;
  useEffect(() => {
    if (enabled && dataUpdatedAt > 0 && dataUpdatedAt < mountedAt.current) void refetch();
  }, [enabled, dataUpdatedAt, refetch]);
  useEffect(() => {
    if (!isSuccess || !data || dataUpdatedAt < mountedAt.current) return;
    const live = new Set(data.terminals.map((terminal) => terminal.id));
    useDesksStore.getState().closeDeadTerminalTabs({ serverId, workspaceId }, live);
  }, [isSuccess, data, dataUpdatedAt, serverId, workspaceId]);
  return null;
}
