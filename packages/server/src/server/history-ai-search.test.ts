import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type HistoryAiStructuredGenerate,
  collectHistoryAiSearchCandidates,
  normalizeHistoryAiSearchPlan,
  runHistoryAiSearch,
} from "./history-ai-search.js";
import { HistoryContentIndex } from "./history-content-index.js";

// CUSTOM(history-ai-search)

const NOW = new Date(2026, 9, 18, 15, 0);

function at(day: number, hour: number): string {
  return new Date(2026, 9, day, hour, 0).toISOString();
}

function agent(input: {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
}): AgentSnapshotPayload {
  // The search reads only these fields; the rest of the snapshot is the session's business.
  return {
    id: input.id,
    title: input.title,
    provider: "claude",
    cwd: "/home/me/game",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    archivedAt: null,
  } as unknown as AgentSnapshotPayload;
}

interface FakeModel {
  generate: HistoryAiStructuredGenerate;
  prompts: string[];
}

/** Answers the plan call with `plan`, and the pick call with the candidates titled `pick`. */
function fakeModel(input: {
  plan: { queries: string[]; since: string | null; until: string | null };
  pick: string[];
}): FakeModel {
  const prompts: string[] = [];
  const generate = (async ({ prompt, schemaName }: { prompt: string; schemaName: string }) => {
    prompts.push(prompt);
    if (schemaName === "HistorySearchPlan") return input.plan;
    const results = input.pick.flatMap((title) => {
      const match = new RegExp(`\\[(\\d+)\\] "${title}"`).exec(prompt);
      return match ? [{ id: Number(match[1]), reason: `${title} has it.` }] : [];
    });
    return { results };
  }) as HistoryAiStructuredGenerate;
  return { generate, prompts };
}

describe("runHistoryAiSearch", () => {
  let index: HistoryContentIndex;

  beforeEach(() => {
    index = new HistoryContentIndex(":memory:");
  });

  afterEach(() => {
    index.close();
  });

  it("searches the asked day by keywords and returns the model's picks with their reasons", async () => {
    const agents = [
      agent({ id: "report", title: "Profile Android build", createdAt: at(18, 14) }),
      agent({ id: "shader", title: "Tune terrain shader", createdAt: at(18, 10) }),
      agent({ id: "old", title: "Old Android profile", createdAt: at(17, 9) }),
    ];
    index.addMessages("report", [
      { role: "user", text: "faz um profile no android" },
      { role: "assistant", text: "Relatório: os principais ofensores no Android são a HUD" },
    ]);
    index.addMessages("shader", [{ role: "assistant", text: "O shader do terreno no Android" }]);
    index.addMessages("old", [{ role: "assistant", text: "Relatório do Android de ontem" }]);
    const model = fakeModel({
      plan: { queries: ["android relatorio", "android report"], since: "2026-10-18", until: null },
      pick: ["Profile Android build"],
    });

    const outcome = await runHistoryAiSearch({
      question: "relatório de melhorias para android de hoje",
      agents,
      index,
      generate: model.generate,
      now: NOW,
    });

    expect(outcome.results).toEqual([
      { agentId: "report", reason: "Profile Android build has it." },
    ]);
    expect(outcome.queries).toEqual(["android relatorio", "android report"]);
    expect(outcome.since).toBe("2026-10-18");
    const pickPrompt = model.prompts[1];
    expect(pickPrompt).toContain('Opening request: "faz um profile no android"');
    expect(pickPrompt).toContain("Relatório: os principais ofensores");
    expect(pickPrompt).not.toContain("Old Android profile");
  });

  it("skips the pick call when an undated question finds nothing", async () => {
    const model = fakeModel({
      plan: { queries: ["kubernetes"], since: null, until: null },
      pick: [],
    });

    const outcome = await runHistoryAiSearch({
      question: "where did I set up kubernetes?",
      agents: [agent({ id: "a", title: "Fix login", createdAt: at(18, 9) })],
      index,
      generate: model.generate,
      now: NOW,
    });

    expect(outcome.results).toEqual([]);
    expect(model.prompts).toHaveLength(1);
  });

  it("drops picks that name no candidate or repeat one", async () => {
    index.addMessages("a", [{ role: "user", text: "deploy the relay" }]);
    const generate = (async ({ schemaName }: { schemaName: string }) =>
      schemaName === "HistorySearchPlan"
        ? { queries: ["relay"], since: null, until: null }
        : {
            results: [
              { id: 7, reason: "not a candidate" },
              { id: 1, reason: "first" },
              { id: 1, reason: "again" },
            ],
          }) as HistoryAiStructuredGenerate;

    const outcome = await runHistoryAiSearch({
      question: "relay deploy",
      agents: [agent({ id: "a", title: "Relay", createdAt: at(18, 9) })],
      index,
      generate,
      now: NOW,
    });

    expect(outcome.results).toEqual([{ agentId: "a", reason: "first" }]);
  });
});

describe("collectHistoryAiSearchCandidates", () => {
  it("ranks sessions found by more queries first and matches titles too", () => {
    const index = new HistoryContentIndex(":memory:");
    index.addMessages("both", [{ role: "user", text: "android hud minimap" }]);
    index.addMessages("one", [{ role: "user", text: "android only" }]);
    const candidates = collectHistoryAiSearchCandidates({
      plan: { queries: ["android", "minimap"], since: null, until: null },
      agents: [
        agent({ id: "one", title: "Something", createdAt: at(18, 12) }),
        agent({ id: "both", title: "Other", createdAt: at(17, 12) }),
        agent({ id: "titled", title: "Minimap redraw", createdAt: at(16, 12) }),
      ],
      index,
    });
    index.close();

    expect(candidates.map((candidate) => [candidate.agent.id, candidate.hits])).toEqual([
      ["both", 2],
      ["one", 1],
      ["titled", 1],
    ]);
  });

  it("fills a dated question with that period's other sessions when keywords miss", () => {
    const candidates = collectHistoryAiSearchCandidates({
      plan: { queries: ["nothing-matches"], since: "2026-10-18", until: "2026-10-18" },
      agents: [
        agent({ id: "today", title: "Today", createdAt: at(18, 9) }),
        agent({ id: "yesterday", title: "Yesterday", createdAt: at(17, 9) }),
        agent({ id: "tomorrow", title: "Tomorrow", createdAt: at(19, 9) }),
        // Started before the day, still active during it.
        agent({ id: "spans", title: "Spans", createdAt: at(17, 9), updatedAt: at(18, 11) }),
      ],
      index: null,
    });

    expect(candidates.map((candidate) => candidate.agent.id)).toEqual(["spans", "today"]);
  });
});

describe("normalizeHistoryAiSearchPlan", () => {
  it("trims and dedupes queries, keeps six, and drops dates it can't read", () => {
    expect(
      normalizeHistoryAiSearchPlan({
        queries: [" a ", "a", "", "b", "c", "d", "e", "f", "g"],
        since: "yesterday",
        until: "2026-10-18",
      }),
    ).toEqual({ queries: ["a", "b", "c", "d", "e", "f"], since: null, until: "2026-10-18" });
  });
});
