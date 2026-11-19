// CUSTOM(assistant-sidebar)
import { describe, expect, it } from "vitest";
import type { SessionState } from "@/stores/session-store";
import { createAssistantAgentMapsCache } from "./session-agent-maps";

function session(input: { agents?: Map<string, unknown>; hydrated?: boolean }): SessionState {
  return {
    agents: input.agents ?? new Map(),
    hasHydratedAgents: input.hydrated ?? false,
  } as unknown as SessionState;
}

describe("assistantAgentMaps", () => {
  it("keeps the snapshot while the agents maps and hydration flags are the same", () => {
    const getMaps = createAssistantAgentMapsCache();
    const state = { s1: session({ hydrated: true }) };
    const first = getMaps(state);
    // The session store replaces the whole `sessions` object on every update.
    const second = getMaps({ ...state });
    expect(second).toBe(first);
    expect(second.agentsByServer.get("s1")).toBe(first.agentsByServer.get("s1"));
    expect([...second.hydratedServerIds]).toEqual(["s1"]);
  });

  it("rebuilds when an agents map is replaced", () => {
    const getMaps = createAssistantAgentMapsCache();
    const first = getMaps({ s1: session({}) });
    const second = getMaps({ s1: session({ agents: new Map([["chat", {}]]) }) });
    expect(second).not.toBe(first);
    expect(second.agentsByServer.get("s1")?.size).toBe(1);
  });

  it("rebuilds when a server finishes hydrating, so its remembered chat starts counting", () => {
    const getMaps = createAssistantAgentMapsCache();
    const agents = new Map([["chat", {}]]);
    const loading = getMaps({ s1: session({ agents }) });
    expect(loading.hydratedServerIds.size).toBe(0);
    const hydrated = getMaps({ s1: session({ agents, hydrated: true }) });
    expect(hydrated).not.toBe(loading);
    expect([...hydrated.hydratedServerIds]).toEqual(["s1"]);
  });
});
