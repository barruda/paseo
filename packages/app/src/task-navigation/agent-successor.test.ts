import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import { useDraftStore } from "@/stores/draft-store";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  AGENT_REPLACES_LABEL,
  draftToCarry,
  findAgentSuccessor,
  planAgentSuccessorFollows,
} from "./agent-successor";
import { followAgentSuccessor } from "./use-agent-successor-tabs";

const agent = (input: { labels?: Record<string, string>; archived?: boolean }) => ({
  labels: input.labels ?? {},
  archivedAt: input.archived ? new Date() : null,
  workspaceId: "ws",
});
const replacing = (id: string, archived = false) =>
  agent({ labels: { [AGENT_REPLACES_LABEL]: id }, archived });

describe("findAgentSuccessor", () => {
  it("finds the live agent that names the archived one", () => {
    const agents = new Map([
      ["old", agent({ archived: true })],
      ["other", agent({})],
      ["new", replacing("old")],
    ]);
    expect(findAgentSuccessor(agents, "old")).toEqual({ agentId: "new", workspaceId: "ws" });
    expect(findAgentSuccessor(agents, "other")).toBeNull();
  });
  it("ignores an archived successor, as when compaction gives up on the new chat", () => {
    const agents = new Map([
      ["old", agent({ archived: true })],
      ["new", replacing("old", true)],
    ]);
    expect(findAgentSuccessor(agents, "old")).toBeNull();
  });
});

describe("planAgentSuccessorFollows", () => {
  it("splits newly archived agents into followed and closed ones", () => {
    const byServer = new Map([
      [
        "home",
        new Map([
          ["old", agent({ archived: true })],
          ["plain", agent({ archived: true })],
          ["new", replacing("old")],
        ]),
      ],
    ]);
    expect(planAgentSuccessorFollows(["home:old", "home:plain", "away:x"], byServer)).toEqual({
      follows: [{ serverId: "home", fromAgentId: "old", toAgentId: "new", toWorkspaceId: "ws" }],
      rest: ["home:plain", "away:x"],
    });
  });
});

describe("draftToCarry", () => {
  const draft = (text: string) => ({ text, attachments: [] });
  it("carries a non-empty draft to a successor with none", () => {
    expect(draftToCarry(draft("half typed"), undefined)).toEqual(draft("half typed"));
    expect(draftToCarry(draft("half typed"), draft("  "))).toEqual(draft("half typed"));
  });
  it("leaves an empty draft and never overwrites the successor's", () => {
    expect(draftToCarry(draft("  "), undefined)).toBeNull();
    expect(draftToCarry(undefined, undefined)).toBeNull();
    expect(draftToCarry(draft("old"), draft("new"))).toBeNull();
  });
});

describe("followAgentSuccessor", () => {
  const workspaceKey = "home:ws";
  const agentTargets = () =>
    useWorkspaceLayoutStore
      .getState()
      .getWorkspaceTabs(workspaceKey)
      .map((tab) => tab.target)
      .filter((target) => target.kind === "agent");
  beforeEach(() => {
    useWorkspaceLayoutStore.setState({
      layoutByWorkspace: {},
      splitSizesByWorkspace: {},
      pinnedAgentIdsByWorkspace: {},
      hiddenAgentIdsByWorkspace: {},
    });
  });

  it("moves the workspace tab and the composer draft, and leaves other agents' tabs", () => {
    const layout = useWorkspaceLayoutStore.getState();
    layout.openTab({ workspaceKey, target: { kind: "agent", agentId: "other" }, intent: "new" });
    layout.openTab({
      workspaceKey,
      target: { kind: "agent", agentId: "old" },
      intent: "new",
      pin: true,
    });
    const pinnedOld = () =>
      useWorkspaceLayoutStore.getState().pinnedAgentIdsByWorkspace[workspaceKey]?.has("old") ??
      false;
    expect(pinnedOld()).toBe(true);
    const fromKey = buildDraftStoreKey({ serverId: "home", agentId: "old" });
    const toKey = buildDraftStoreKey({ serverId: "home", agentId: "new" });
    useDraftStore.getState().saveDraftInput({
      draftKey: fromKey,
      draft: { text: "half typed", attachments: [] },
    });

    followAgentSuccessor({
      serverId: "home",
      fromAgentId: "old",
      toAgentId: "new",
      toWorkspaceId: "ws",
    });

    expect(agentTargets()).toEqual([
      { kind: "agent", agentId: "other" },
      { kind: "agent", agentId: "new" },
    ]);
    // Unpinned, or the next reconcile would bring the archived chat's tab back.
    expect(pinnedOld()).toBe(false);
    expect(useDraftStore.getState().getDraftInput(toKey)?.text).toBe("half typed");
    expect(useDraftStore.getState().getDraftInput(fromKey)).toBeUndefined();
  });

  it("closes the old tab when the successor already has one", () => {
    const layout = useWorkspaceLayoutStore.getState();
    layout.openTab({ workspaceKey, target: { kind: "agent", agentId: "old" }, intent: "new" });
    layout.openTab({ workspaceKey, target: { kind: "agent", agentId: "new" }, intent: "new" });
    followAgentSuccessor({
      serverId: "home",
      fromAgentId: "old",
      toAgentId: "new",
      toWorkspaceId: "ws",
    });
    expect(agentTargets()).toEqual([{ kind: "agent", agentId: "new" }]);
  });
});
