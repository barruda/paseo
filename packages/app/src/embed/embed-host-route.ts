// CUSTOM(agent-embed): an embedded page must not redirect away when its host is not known yet.
import { useEffect, useState } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

export type EmbedHostRouteDecision = "render" | "loading" | "unavailable";

export function resolveEmbedHostRoute(input: {
  hostKnown: boolean;
  hostRegistryLoading: boolean;
  startupBlocked: boolean;
  bootSettled: boolean;
}): EmbedHostRouteDecision {
  if (input.hostKnown) {
    return "render";
  }
  if (input.hostRegistryLoading || input.startupBlocked || !input.bootSettled) {
    return "loading";
  }
  return "unavailable";
}

/** True once registry load and the initial connection hint bootstrap have finished. */
export function useEmbedHostBootSettled(): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const markSettled = () => {
      if (!cancelled) setSettled(true);
    };
    getHostRuntimeStore().boot().then(markSettled, markSettled);
    return () => {
      cancelled = true;
    };
  }, []);
  return settled;
}
