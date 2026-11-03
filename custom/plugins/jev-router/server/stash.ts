import type { JevRouteCardData } from "@getpaseo/protocol/jev-router";

// The `route` RPC runs before the agent exists; its `agent.created` hook appends the card. This
// holds each applied route's card in between, by the route id the app puts on the agent's labels.

const TTL_MS = 10 * 60_000;

export class RouteCardStash {
  private readonly cards = new Map<string, { card: JevRouteCardData; at: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  put(routeId: string, card: JevRouteCardData): void {
    this.prune();
    this.cards.set(routeId, { card, at: this.now() });
  }

  take(routeId: string): JevRouteCardData | null {
    this.prune();
    const entry = this.cards.get(routeId);
    this.cards.delete(routeId);
    return entry?.card ?? null;
  }

  private prune(): void {
    const cutoff = this.now() - TTL_MS;
    for (const [id, entry] of this.cards) if (entry.at < cutoff) this.cards.delete(id);
  }
}
