// CUSTOM(assistant-draft-carry): when the Projects Assistant chat restarts (a compaction on the
// context limit, or Restart chat), the composer draft of the old chat moves to the new chat. The
// daemon archives the old chat, and the app's active directory gets a `remove` for it:
// `removeFromDirectory` drops the agent and then deletes its draft. This runs in a session-store
// subscription, which fires inside that `setAgents`, before the draft is deleted and before React
// mounts the new chat's composer. Dictation writes its partial text to the draft, so dictated
// text moves too. See custom/CHANGES.md.
import type { UserComposerAttachment } from "@/attachments/types";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore, type DraftInput } from "@/stores/draft-store";
import { useSessionStore } from "@/stores/session-store";
import { findAgentSuccessor } from "@/task-navigation/agent-successor";
import { isLiveAssistantChatAgent, resolveAssistantChat, type AssistantAgentFacts } from "./model";

type AgentsByServer = ReadonlyMap<string, ReadonlyMap<string, AssistantAgentFacts>>;

/** A chat that stopped being live, and the live chat on its server that takes over (or null). */
export interface AssistantChatHandoff {
  serverId: string;
  fromAgentId: string;
  toAgentId: string | null;
}

/** How long a draft waits for a new chat when the old one left before the new one appeared. */
export const DRAFT_CARRY_WAIT_MS = 60_000;

/** The live assistant chats of each server. */
export function liveAssistantChats(agentsByServer: AgentsByServer): Map<string, Set<string>> {
  const live = new Map<string, Set<string>>();
  for (const [serverId, agents] of agentsByServer) {
    const ids = new Set<string>();
    for (const [agentId, agent] of agents) if (isLiveAssistantChatAgent(agent)) ids.add(agentId);
    if (ids.size > 0) live.set(serverId, ids);
  }
  return live;
}

/** The chat that takes over from `fromAgentId`: its successor, else the newest live chat. */
function takeoverChat(
  serverId: string,
  agents: ReadonlyMap<string, AssistantAgentFacts>,
  fromAgentId: string,
): string | null {
  const successor = findAgentSuccessor(agents, fromAgentId);
  if (successor && isLiveAssistantChatAgent(agents.get(successor.agentId))) {
    return successor.agentId;
  }
  const newest = resolveAssistantChat({
    remembered: null,
    agentsByServer: new Map([[serverId, agents]]),
    preferredServerId: serverId,
  });
  return newest && newest.agentId !== fromAgentId ? newest.agentId : null;
}

/**
 * The chats live in `previous` that are no longer live in `agentsByServer` (removed from the
 * active list or archived). A server missing from `agentsByServer` is skipped: nothing is known.
 */
export function planAssistantChatHandoffs(input: {
  previous: ReadonlyMap<string, ReadonlySet<string>>;
  agentsByServer: AgentsByServer;
}): AssistantChatHandoff[] {
  const handoffs: AssistantChatHandoff[] = [];
  for (const [serverId, ids] of input.previous) {
    const agents = input.agentsByServer.get(serverId);
    if (!agents) continue;
    for (const fromAgentId of ids) {
      if (isLiveAssistantChatAgent(agents.get(fromAgentId))) continue;
      handoffs.push({
        serverId,
        fromAgentId,
        toAgentId: takeoverChat(serverId, agents, fromAgentId),
      });
    }
  }
  return handoffs;
}

function hasContent(draft: DraftInput | undefined): draft is DraftInput {
  return !!draft && (draft.text.trim().length > 0 || draft.attachments.length > 0);
}

/**
 * The draft the new chat gets. An empty carried draft changes nothing (null). When the new chat
 * already has a draft, both are kept: its text first, then a blank line and the carried text, so
 * the cursor lands after what the user was writing; attachments are joined without duplicates.
 */
export function mergeCarriedDraft(
  carried: DraftInput | undefined,
  existing: DraftInput | undefined,
): DraftInput | null {
  if (!hasContent(carried)) return null;
  if (!hasContent(existing)) return carried;
  const text = [existing.text.trimEnd(), carried.text.trim()].filter(Boolean).join("\n\n");
  const seen = new Set(existing.attachments.map((attachment) => JSON.stringify(attachment)));
  const attachments: UserComposerAttachment[] = [
    ...existing.attachments,
    ...carried.attachments.filter((attachment) => !seen.has(JSON.stringify(attachment))),
  ];
  return { text, attachments };
}

function draftKey(serverId: string, agentId: string): string {
  return buildDraftStoreKey({ serverId, agentId });
}

function moveDraft(input: {
  serverId: string;
  fromAgentId: string;
  toAgentId: string;
  draft: DraftInput;
}): void {
  const drafts = useDraftStore.getState();
  const toKey = draftKey(input.serverId, input.toAgentId);
  const merged = mergeCarriedDraft(input.draft, drafts.getDraftInput(toKey));
  if (!merged) return;
  drafts.saveDraftInput({ draftKey: toKey, draft: merged });
  drafts.clearDraftInput({
    draftKey: draftKey(input.serverId, input.fromAgentId),
    lifecycle: "abandoned",
  });
}

interface WaitingDraft {
  fromAgentId: string;
  draft: DraftInput;
  at: number;
}

/**
 * Watches the session store and moves an assistant chat's draft to the chat that takes over when
 * it stops being live. When no chat has taken over yet, a copy waits (DRAFT_CARRY_WAIT_MS) for
 * one; if the old chat comes back instead, its draft is put back. Returns the unsubscribe.
 */
export function startAssistantDraftCarry(options: { now?: () => number } = {}): () => void {
  const now = options.now ?? Date.now;
  let previous = new Map<string, Set<string>>();
  let lastMaps: unknown[] = [];
  const waiting = new Map<string, WaitingDraft>();

  const deliverWaiting = (agentsByServer: AgentsByServer) => {
    for (const [serverId, entry] of waiting) {
      if (now() - entry.at > DRAFT_CARRY_WAIT_MS) {
        waiting.delete(serverId);
        continue;
      }
      const agents = agentsByServer.get(serverId);
      if (!agents) continue;
      if (isLiveAssistantChatAgent(agents.get(entry.fromAgentId))) {
        // A transient removal: the old chat is back, so its draft goes back if it lost it.
        waiting.delete(serverId);
        const drafts = useDraftStore.getState();
        const fromKey = draftKey(serverId, entry.fromAgentId);
        if (!hasContent(drafts.getDraftInput(fromKey))) {
          drafts.saveDraftInput({ draftKey: fromKey, draft: entry.draft });
        }
        continue;
      }
      const toAgentId = takeoverChat(serverId, agents, entry.fromAgentId);
      if (!toAgentId) continue;
      waiting.delete(serverId);
      moveDraft({ serverId, fromAgentId: entry.fromAgentId, toAgentId, draft: entry.draft });
    }
  };

  const check = () => {
    const sessions = useSessionStore.getState().sessions;
    const maps = Object.entries(sessions).flatMap(([serverId, session]) => [
      serverId,
      session.agents,
    ]);
    if (maps.length === lastMaps.length && maps.every((map, index) => map === lastMaps[index])) {
      return;
    }
    lastMaps = maps;
    const agentsByServer = new Map<string, ReadonlyMap<string, AssistantAgentFacts>>();
    for (const [serverId, session] of Object.entries(sessions)) {
      agentsByServer.set(serverId, session.agents);
    }
    for (const handoff of planAssistantChatHandoffs({ previous, agentsByServer })) {
      const draft = useDraftStore
        .getState()
        .getDraftInput(draftKey(handoff.serverId, handoff.fromAgentId));
      if (!hasContent(draft)) continue;
      if (handoff.toAgentId) {
        moveDraft({ ...handoff, toAgentId: handoff.toAgentId, draft });
      } else {
        // The store deletes the old draft right after this; keep a copy for the new chat.
        waiting.set(handoff.serverId, { fromAgentId: handoff.fromAgentId, draft, at: now() });
      }
    }
    deliverWaiting(agentsByServer);
    previous = liveAssistantChats(agentsByServer);
  };

  check();
  return useSessionStore.subscribe(check);
}
