// CUSTOM(jev-router): Esc 3×, the agent panel's side. After a keyboard interrupt of this agent, the
// next plain Escape does what the Jev route card's button does (see ./triple-esc.ts). Only the
// interactive panel reacts, and a ref guards against two triggers racing.

import { useEffect, useRef } from "react";
import { JevRouteCardDataSchema, JEV_ROUTER_PLUGIN_ID } from "@getpaseo/protocol/jev-router";
import { useInstalledPlugin } from "@/plugins/registry";
import { useSessionStore, type SessionState } from "@/stores/session-store";
import { findJevRouteCardData } from "./model";
import { subscribeJevEscRestart } from "./triple-esc";
import { turnJevRouterOff } from "./turn-off";
import { useRestartAgent } from "./use-restart-agent";

export function selectJevRouteCardData(
  session: SessionState | undefined,
  agentId: string,
): unknown {
  if (!session) return undefined;
  return (
    findJevRouteCardData(session.agentStreamTail.get(agentId) ?? []) ??
    findJevRouteCardData(session.agentStreamHead.get(agentId) ?? [])
  );
}

export function useJevEscRestart(serverId: string, agentId: string, isInteractive: boolean) {
  const plugin = useInstalledPlugin(serverId, JEV_ROUTER_PLUGIN_ID);
  const rawCard = useSessionStore((state) =>
    isInteractive ? selectJevRouteCardData(state.sessions[serverId], agentId) : undefined,
  );
  const { restart, ready } = useRestartAgent(serverId, agentId);
  const latest = useRef({ plugin, rawCard, restart, ready });
  latest.current = { plugin, rawCard, restart, ready };
  const fired = useRef(false);

  useEffect(() => {
    fired.current = false;
  }, [agentId, serverId]);

  useEffect(() => {
    if (!isInteractive) return;
    return subscribeJevEscRestart((target) => {
      if (target.serverId !== serverId || target.agentId !== agentId || fired.current) return;
      const current = latest.current;
      const parsed = JevRouteCardDataSchema.safeParse(current.rawCard);
      if (!parsed.success || parsed.data.prompt === null || !current.plugin || !current.ready) {
        return;
      }
      fired.current = true;
      const { plugin: installed } = current;
      void current.restart({
        prompt: parsed.data.prompt,
        model: parsed.data.homeModelId,
        thinkingOptionId: parsed.data.homeThinkingOptionId,
        onBeforeRestart: () => turnJevRouterOff(installed),
      });
    });
  }, [agentId, isInteractive, serverId]);
}
