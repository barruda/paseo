import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { createStore } from "zustand/vanilla";

interface SettingsRouteEntry {
  key: string;
  pathname: string;
}

interface SettingsSelectionState {
  selectedServerId: string | null;
  // CUSTOM(settings-filter): survives the sibling-route remounts of the sidebar.
  filterQuery: string;
  sidebarReturn: (ActiveWorkspaceSelection & { phase: "opening" | "covered" }) | null;
}

export function createSettingsPresentation() {
  const store = createStore<SettingsSelectionState>(() => ({
    selectedServerId: null,
    filterQuery: "",
    sidebarReturn: null,
  }));
  const enteredRoutes = new Map<string, string>();
  let inSettings = false;
  let sidebarOffset = 0;
  let sidebarOwner: object | null = null;
  // CUSTOM(settings-last-page): in-memory, deliberately not reset when leaving Settings.
  let lastPathname: string | null = null;

  function beginSidebarVisit(workspace: ActiveWorkspaceSelection) {
    store.setState({ sidebarReturn: { ...workspace, phase: "opening" } });
  }

  function presentContent() {
    const origin = store.getState().sidebarReturn;
    if (origin?.phase === "opening") {
      store.setState({ sidebarReturn: { ...origin, phase: "covered" } });
    }
  }

  function clearSidebarReturn() {
    if (store.getState().sidebarReturn) store.setState({ sidebarReturn: null });
  }

  function attachSidebar() {
    const owner = {};
    sidebarOwner = owner;
    return {
      get offset() {
        return sidebarOffset;
      },
      remember(offset: number) {
        if (sidebarOwner === owner) sidebarOffset = offset;
      },
      detach() {
        if (sidebarOwner === owner) sidebarOwner = null;
      },
    };
  }

  function enterRoute(
    { key, pathname }: SettingsRouteEntry,
    workspaceServerId: string | null,
  ): boolean {
    const isSettings = pathname === "/settings" || pathname.startsWith("/settings/");
    if (!isSettings) {
      // CUSTOM(settings-last-page): keep sidebarOffset so the scroll position comes back.
      const origin = store.getState().sidebarReturn;
      const destination = parseHostWorkspaceRouteFromPathname(pathname);
      const discardSidebar =
        origin !== null &&
        (origin.serverId !== destination?.serverId ||
          origin.workspaceId !== destination?.workspaceId);
      clearSidebarReturn();
      sidebarOwner = null;
      store.setState({ filterQuery: "" }); // CUSTOM(settings-filter)
      inSettings = false;
      enteredRoutes.clear();
      return discardSidebar;
    }
    // CUSTOM(settings-last-page)
    if (pathname !== "/settings") lastPathname = pathname;
    // A retained route returning through Back must not replay its old host intent.
    if (enteredRoutes.get(key) === pathname) return false;
    const isNewVisit = !inSettings;
    inSettings = true;
    enteredRoutes.set(key, pathname);

    const hostMatch = /^\/settings\/hosts\/([^/]+)(?:\/|$)/.exec(pathname);
    if (hostMatch) {
      store.setState({ selectedServerId: decodeURIComponent(hostMatch[1]) });
    } else if (isNewVisit) {
      store.setState({ selectedServerId: workspaceServerId });
    }
    return false;
  }

  function selectHost(serverId: string): void {
    store.setState({ selectedServerId: serverId });
  }

  // CUSTOM(settings-filter)
  function setFilterQuery(query: string): void {
    store.setState({ filterQuery: query });
  }

  // CUSTOM(settings-last-page)
  function getLastSettingsPathname(): string | null {
    return lastPathname;
  }

  return {
    store,
    enterRoute,
    selectHost,
    attachSidebar,
    setFilterQuery,
    getLastSettingsPathname,
    beginSidebarVisit,
    clearSidebarReturn,
    presentContent,
  };
}
