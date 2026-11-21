// CUSTOM(assistant-draft-carry)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import type { UserComposerAttachment } from "@/attachments/types";
import { AgentStoreProjection } from "@/runtime/directory-sync/internal/agent-store";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { AGENT_REPLACES_LABEL } from "@/task-navigation/agent-successor";
import {
  DRAFT_CARRY_WAIT_MS,
  mergeCarriedDraft,
  planAssistantChatHandoffs,
  startAssistantDraftCarry,
} from "./draft-carry";
import { ASSISTANT_CHAT_LABEL } from "./model";

const CHAT = { [ASSISTANT_CHAT_LABEL]: "true" };
const IMAGE: UserComposerAttachment = {
  kind: "image",
  metadata: {
    id: "img-1",
    mimeType: "image/png",
    storageType: "web-indexeddb",
    storageKey: "k1",
    createdAt: 1,
  },
};

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    labels: CHAT,
    archivedAt: null,
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    pendingPermissions: [],
    workspaceId: "ws",
    createdAt: new Date(1),
    ...overrides,
  } as unknown as Agent;
}

function seedSession(agents: Agent[]): void {
  useSessionStore.setState({ sessions: {} });
  useSessionStore.getState().initializeSession("s1", null);
  setAgents(agents);
}

function setAgents(agents: Agent[]): void {
  useSessionStore.getState().setAgents("s1", new Map(agents.map((entry) => [entry.id, entry])));
}

const key = (agentId: string) => buildDraftStoreKey({ serverId: "s1", agentId });
const draftOf = (agentId: string) => useDraftStore.getState().getDraftInput(key(agentId));
function typeInto(agentId: string, text: string, attachments: UserComposerAttachment[] = []) {
  useDraftStore.getState().saveDraftInput({ draftKey: key(agentId), draft: { text, attachments } });
}

const successor = (id: string, replaces: string, createdAt = 2) =>
  agent(id, {
    labels: { ...CHAT, [AGENT_REPLACES_LABEL]: replaces },
    createdAt: new Date(createdAt),
  });

describe("mergeCarriedDraft", () => {
  it("returns null for an empty carried draft", () => {
    expect(mergeCarriedDraft(undefined, undefined)).toBeNull();
    expect(mergeCarriedDraft({ text: "  ", attachments: [] }, undefined)).toBeNull();
  });

  it("keeps both texts when the new chat already has one, the carried one last", () => {
    expect(
      mergeCarriedDraft(
        { text: "old words", attachments: [IMAGE] },
        { text: "new words\n", attachments: [IMAGE] },
      ),
    ).toEqual({ text: "new words\n\nold words", attachments: [IMAGE] });
  });
});

describe("planAssistantChatHandoffs", () => {
  it("names the successor of a removed chat, else the newest live chat, else none", () => {
    const previous = new Map([["s1", new Set(["old"])]]);
    const plan = (agents: Agent[]) =>
      planAssistantChatHandoffs({
        previous,
        agentsByServer: new Map([["s1", new Map(agents.map((entry) => [entry.id, entry]))]]),
      });
    expect(plan([successor("next", "old"), agent("newest", { createdAt: new Date(9) })])).toEqual([
      { serverId: "s1", fromAgentId: "old", toAgentId: "next" },
    ]);
    expect(plan([agent("restart", { createdAt: new Date(5) })])).toEqual([
      { serverId: "s1", fromAgentId: "old", toAgentId: "restart" },
    ]);
    expect(plan([])).toEqual([{ serverId: "s1", fromAgentId: "old", toAgentId: null }]);
    expect(plan([agent("old")])).toEqual([]);
    expect(planAssistantChatHandoffs({ previous, agentsByServer: new Map() })).toEqual([]);
  });
});

describe("startAssistantDraftCarry", () => {
  let stop: () => void = () => undefined;
  let clock = 1_000;

  beforeEach(() => {
    clock = 1_000;
    useDraftStore.setState({ drafts: {}, createModalDraft: null });
  });

  afterEach(() => stop());

  const start = () => {
    stop = startAssistantDraftCarry({ now: () => clock });
  };

  it("moves typed and dictated text and attachments before the directory deletes the old draft", () => {
    seedSession([agent("old"), successor("next", "old")]);
    start();
    typeInto("old", "dictated so far", [IMAGE]);

    // What the daemon's archive does to the app: a `remove` of the old chat from the active list.
    new AgentStoreProjection("s1").removeFromDirectory("old");

    expect(draftOf("next")).toEqual({ text: "dictated so far", attachments: [IMAGE] });
    expect(draftOf("old")).toBeUndefined();
  });

  it("moves the draft when the old chat is archived in place", () => {
    seedSession([agent("old"), successor("next", "old")]);
    start();
    typeInto("old", "half typed");

    setAgents([agent("old", { archivedAt: new Date(3) }), successor("next", "old")]);

    expect(draftOf("next")?.text).toBe("half typed");
    expect(draftOf("old")).toBeUndefined();
  });

  it("joins the drafts when the new chat already has text", () => {
    seedSession([agent("old"), successor("next", "old")]);
    start();
    typeInto("old", "old words");
    typeInto("next", "new words");

    new AgentStoreProjection("s1").removeFromDirectory("old");

    expect(draftOf("next")?.text).toBe("new words\n\nold words");
  });

  it("changes nothing for an empty composer", () => {
    seedSession([agent("old"), successor("next", "old")]);
    start();

    new AgentStoreProjection("s1").removeFromDirectory("old");

    expect(useDraftStore.getState().drafts).toEqual({});
  });

  it("leaves other agents' drafts alone", () => {
    seedSession([agent("worker", { labels: {} }), agent("chat")]);
    start();
    typeInto("worker", "not the assistant");

    new AgentStoreProjection("s1").removeFromDirectory("worker");

    expect(draftOf("chat")).toBeUndefined();
  });

  it("holds the draft for a new chat that shows up after the old one left", () => {
    seedSession([agent("old")]);
    start();
    typeInto("old", "wait for me");

    new AgentStoreProjection("s1").removeFromDirectory("old");
    expect(draftOf("old")).toBeUndefined();
    clock += DRAFT_CARRY_WAIT_MS - 1;
    setAgents([agent("fresh", { createdAt: new Date(7) })]);

    expect(draftOf("fresh")?.text).toBe("wait for me");
  });

  it("drops a held draft after the wait", () => {
    seedSession([agent("old")]);
    start();
    typeInto("old", "too late");

    new AgentStoreProjection("s1").removeFromDirectory("old");
    clock += DRAFT_CARRY_WAIT_MS + 1;
    setAgents([agent("fresh", { createdAt: new Date(7) })]);

    expect(draftOf("fresh")).toBeUndefined();
  });

  it("gives a held draft back when the old chat returns", () => {
    seedSession([agent("old")]);
    start();
    typeInto("old", "still mine");

    new AgentStoreProjection("s1").removeFromDirectory("old");
    setAgents([agent("old")]);

    expect(draftOf("old")?.text).toBe("still mine");
  });
});
