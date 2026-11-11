import { randomUUID } from "node:crypto";
import type { DelegationCardData } from "@getpaseo/protocol/delegation";

// `agent.create` runs before the agent has an id. It puts an id in the first launch's env, then
// `agent.session_open` (reason "create") ties that id to the agent, and `agent.created` takes the
// entry to append the card and log the session.

const TTL_MS = 10 * 60_000;

export interface DelegationEntry {
  card: DelegationCardData;
  /** The session's main model as created; null for the provider default. */
  mainModel: string | null;
  at: number;
}

export class DelegationTracker {
  private readonly pending = new Map<string, DelegationEntry>();
  private readonly bound = new Map<string, DelegationEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  begin(card: DelegationCardData, mainModel: string | null): string {
    this.prune();
    const id = randomUUID();
    this.pending.set(id, { card, mainModel, at: this.now() });
    return id;
  }

  bind(id: string, agentId: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    this.bound.set(agentId, entry);
  }

  take(agentId: string): DelegationEntry | null {
    this.prune();
    const entry = this.bound.get(agentId) ?? null;
    this.bound.delete(agentId);
    return entry;
  }

  private prune(): void {
    const cutoff = this.now() - TTL_MS;
    for (const map of [this.pending, this.bound])
      for (const [key, entry] of map) if (entry.at < cutoff) map.delete(key);
  }
}
