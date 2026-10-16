import { parseHistoryQuery } from "@getpaseo/protocol/search/history-query";
import { describe, expect, it } from "vitest";
import {
  type AgentHistorySearchCandidate,
  matchAgentHistoryNames,
  matchesAgentHistoryQuery,
} from "./agent-history-search.js";

function candidate(input: {
  title?: string | null;
  workspaceName?: string | null;
  branch?: string | null;
  projectName?: string;
  updatedAt?: string;
}): AgentHistorySearchCandidate & { agent: { id: string; updatedAt: string } } {
  const branch = input.branch ?? null;
  return {
    agent: {
      id: input.title ?? "agent",
      title: input.title ?? null,
      updatedAt: input.updatedAt ?? "2026-08-07T00:00:00.000Z",
    },
    project: {
      projectKey: "key",
      projectName: input.projectName ?? "getpaseo/paseo",
      workspaceName: input.workspaceName ?? null,
      checkout: {
        cwd: "/tmp/repo",
        isGit: branch !== null,
        currentBranch: branch,
        remoteUrl: null,
        worktreeRoot: "/tmp/repo",
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
    // The module only reads the four names; the rest of the payload is the
    // session's business.
  } as unknown as AgentHistorySearchCandidate & { agent: { id: string; updatedAt: string } };
}

describe("matchesAgentHistoryQuery", () => {
  it("rejects scattered letters across words while keeping within-word subsequences", () => {
    expect(
      matchesAgentHistoryQuery(
        "terminal",
        candidate({
          title: "Let me diagnose this problem in a diagnose this problem and",
        }),
      ),
    ).toBe(false);
    expect(matchesAgentHistoryQuery("trmnl", candidate({ title: "Fix terminal resizing" }))).toBe(
      true,
    );
  });

  it("matches the workspace name", () => {
    expect(
      matchesAgentHistoryQuery("stripe", candidate({ workspaceName: "Add Stripe billing" })),
    ).toBe(true);
  });

  it("matches the agent title", () => {
    expect(
      matchesAgentHistoryQuery("entitlements", candidate({ title: "Reshape entitlements" })),
    ).toBe(true);
  });

  it("matches the branch name", () => {
    expect(matchesAgentHistoryQuery("billing", candidate({ branch: "add-stripe-billing" }))).toBe(
      true,
    );
  });

  it("matches the project name", () => {
    expect(matchesAgentHistoryQuery("paseo", candidate({ projectName: "getpaseo/paseo" }))).toBe(
      true,
    );
  });

  it("requires every token to match somewhere", () => {
    const entry = candidate({ workspaceName: "Add Stripe billing", branch: "main" });
    expect(matchesAgentHistoryQuery("stripe main", entry)).toBe(true);
    expect(matchesAgentHistoryQuery("stripe rosetta", entry)).toBe(false);
  });

  it("tolerates a typo", () => {
    expect(
      matchesAgentHistoryQuery("bulling", candidate({ workspaceName: "Add Stripe billing" })),
    ).toBe(true);
  });

  it("tolerates a transposed branch name", () => {
    expect(matchesAgentHistoryQuery("mian", candidate({ branch: "main" }))).toBe(true);
    expect(matchesAgentHistoryQuery("rain", candidate({ branch: "main" }))).toBe(false);
  });

  it("keeps candidates for a blank query", () => {
    expect(matchesAgentHistoryQuery("   ", candidate({ title: "anything" }))).toBe(true);
  });
});

// CUSTOM(history-content-search)
describe("matchAgentHistoryNames", () => {
  const entry = candidate({ title: "Run the tests at once", branch: "fix-staging-relay" });

  it("matches a quoted phrase only as adjacent whole words", () => {
    expect(matchAgentHistoryNames(parseHistoryQuery('"at once"'), entry)).toBe("match");
    expect(matchAgentHistoryNames(parseHistoryQuery('"tests once"'), entry)).toBe("miss");
  });

  it("matches either side of OR", () => {
    expect(matchAgentHistoryNames(parseHistoryQuery("tunnel OR relay"), entry)).toBe("match");
    expect(matchAgentHistoryNames(parseHistoryQuery("tunnel OR socket"), entry)).toBe("miss");
  });

  it("reports an excluded name apart from a miss, without typo tolerance", () => {
    expect(matchAgentHistoryNames(parseHistoryQuery("tests -staging"), entry)).toBe("excluded");
    expect(matchAgentHistoryNames(parseHistoryQuery("-stagnig"), entry)).toBe("match");
    expect(matchAgentHistoryNames(parseHistoryQuery("-ui"), entry)).toBe("match");
  });
});
