import { describe, expect, it } from "vitest";
import { IMPLEMENTER_AGENT_NAME, SEARCH_AGENT_NAME } from "../shared/policy";
import { buildClaudeAgentsEnv, buildImplementerAgent, buildSearchAgent } from "./implementer-agent";

const base = {
  implementerModel: "sonnet",
  implementerEffort: "medium",
  searchModel: "off",
} as const;
const SENTENCE = "read CLAUDE.md and AGENTS.md";

describe("buildImplementerAgent", () => {
  it("keeps CLAUDE.md in full mode", () => {
    const agent = buildImplementerAgent({ ...base, subagentContext: "full" });
    expect("omitClaudeMd" in agent).toBe(false);
    expect(agent.prompt).not.toContain(SENTENCE);
  });

  it("omits CLAUDE.md in project mode and tells the agent to read the repo's own", () => {
    const agent = buildImplementerAgent({ ...base, subagentContext: "project" });
    expect(agent).toMatchObject({ omitClaudeMd: true });
    expect(agent.prompt).toContain(SENTENCE);
  });

  it("omits CLAUDE.md in none mode without the read sentence", () => {
    const agent = buildImplementerAgent({ ...base, subagentContext: "none" });
    expect(agent).toMatchObject({ omitClaudeMd: true });
    expect(agent.prompt).not.toContain(SENTENCE);
  });

  it("takes model and effort from the values", () => {
    const agent = buildImplementerAgent({
      implementerModel: "opus",
      implementerEffort: "low",
      subagentContext: "full",
    });
    expect(agent.model).toBe("opus");
    expect(agent.effort).toBe("low");
  });
});

describe("buildSearchAgent", () => {
  it("is read-only and lean", () => {
    const agent = buildSearchAgent({ searchModel: "sonnet" });
    expect(agent.tools).toEqual(["Bash", "Read", "Glob", "Grep"]);
    expect(agent.omitClaudeMd).toBe(true);
    expect(agent.model).toBe("sonnet");
  });

  it("falls back to haiku when the Search setting is off", () => {
    expect(buildSearchAgent({ searchModel: "off" }).model).toBe("haiku");
    expect(buildSearchAgent({ searchModel: "haiku" }).model).toBe("haiku");
  });
});

describe("buildClaudeAgentsEnv", () => {
  it("is JSON keyed by the implementer and search names", () => {
    const parsed = JSON.parse(buildClaudeAgentsEnv({ ...base, subagentContext: "full" }));
    expect(Object.keys(parsed)).toEqual([IMPLEMENTER_AGENT_NAME, SEARCH_AGENT_NAME]);
    expect(parsed[IMPLEMENTER_AGENT_NAME].tools).toContain("Bash");
    expect(parsed[SEARCH_AGENT_NAME].tools).not.toContain("Edit");
  });
});
