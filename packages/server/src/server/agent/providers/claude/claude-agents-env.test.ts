import { describe, expect, it } from "vitest";
import { CLAUDE_AGENTS_ENV, parseClaudeAgentsEnv } from "./claude-agents-env";

describe("parseClaudeAgentsEnv", () => {
  it("reads agent definitions and keeps extra fields", () => {
    const agents = { impl: { description: "d", prompt: "p", omitClaudeMd: true } };
    expect(parseClaudeAgentsEnv({ [CLAUDE_AGENTS_ENV]: JSON.stringify(agents) })).toEqual(agents);
  });

  it("returns null for a missing, malformed, non-object or invalid value", () => {
    expect(parseClaudeAgentsEnv(undefined)).toBeNull();
    expect(parseClaudeAgentsEnv({})).toBeNull();
    expect(parseClaudeAgentsEnv({ [CLAUDE_AGENTS_ENV]: "nope" })).toBeNull();
    expect(parseClaudeAgentsEnv({ [CLAUDE_AGENTS_ENV]: "[]" })).toBeNull();
    expect(parseClaudeAgentsEnv({ [CLAUDE_AGENTS_ENV]: '"x"' })).toBeNull();
    expect(parseClaudeAgentsEnv({ [CLAUDE_AGENTS_ENV]: '{"a":{"description":"d"}}' })).toBeNull();
    expect(parseClaudeAgentsEnv({ [CLAUDE_AGENTS_ENV]: '{"a":{"prompt":"p"}}' })).toBeNull();
    expect(parseClaudeAgentsEnv({ [CLAUDE_AGENTS_ENV]: '{"a":null}' })).toBeNull();
  });
});
