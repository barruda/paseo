import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  isArchivedExpansionActive,
  selectArchivedAgents,
  shouldOfferArchivedExpansion,
  shouldResetArchivedExpansion,
} from "./expand-archived";

const base = { query: "fix", scoped: false, agentsLoading: false, expanded: false };

describe("shouldOfferArchivedExpansion", () => {
  it("offers for a finished search with a query", () => {
    expect(shouldOfferArchivedExpansion(base)).toBe(true);
  });
  it("hides without a query, while loading, in a scope, or once expanded", () => {
    expect(shouldOfferArchivedExpansion({ ...base, query: "  " })).toBe(false);
    expect(shouldOfferArchivedExpansion({ ...base, agentsLoading: true })).toBe(false);
    expect(shouldOfferArchivedExpansion({ ...base, scoped: true })).toBe(false);
    expect(shouldOfferArchivedExpansion({ ...base, expanded: true })).toBe(false);
  });
});

describe("archived expansion lifecycle", () => {
  it("is active only when expanded, open and with a query", () => {
    expect(isArchivedExpansionActive({ open: true, query: "a", expanded: true })).toBe(true);
    expect(isArchivedExpansionActive({ open: false, query: "a", expanded: true })).toBe(false);
    expect(isArchivedExpansionActive({ open: true, query: "", expanded: true })).toBe(false);
    expect(isArchivedExpansionActive({ open: true, query: "a", expanded: false })).toBe(false);
  });
  it("resets on close or cleared query", () => {
    expect(shouldResetArchivedExpansion({ open: false, query: "a" })).toBe(true);
    expect(shouldResetArchivedExpansion({ open: true, query: " " })).toBe(true);
    expect(shouldResetArchivedExpansion({ open: true, query: "a" })).toBe(false);
  });
});

describe("selectArchivedAgents", () => {
  const agent = (id: string, archivedAt: Date | null) =>
    ({ id, serverId: "s", archivedAt }) as unknown as AggregatedAgent;
  it("keeps archived agents not already shown", () => {
    const result = selectArchivedAgents(
      [agent("a", new Date()), agent("b", null), agent("c", new Date())],
      [{ id: "c", serverId: "s" }],
    );
    expect(result.map((entry) => entry.id)).toEqual(["a"]);
  });
});
