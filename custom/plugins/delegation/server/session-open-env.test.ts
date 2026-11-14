import { describe, expect, it } from "vitest";
import { CLAUDE_AGENTS_ENV } from "./implementer-agent";
import {
  CLAUDE_MAIN_CACHE_TTL_ENV,
  CLAUDE_SUBAGENT_CACHE_TTL_ENV,
  sessionOpenEnv,
} from "./session-open-env";

const values = {
  implementerModel: "sonnet",
  implementerEffort: "medium",
  subagentContext: "full",
  searchModel: "off",
  subagentCacheTtl: "5m",
} as const;

describe("sessionOpenEnv", () => {
  it("gives a Claude session the agents and the subagent TTL only", () => {
    const env = sessionOpenEnv({ provider: "claude", isSubagent: false, values });
    expect(Object.keys(env).sort()).toEqual(
      [CLAUDE_SUBAGENT_CACHE_TTL_ENV, CLAUDE_AGENTS_ENV].sort(),
    );
    expect(env[CLAUDE_SUBAGENT_CACHE_TTL_ENV]).toBe("5m");
  });

  it("also sets the main-conversation TTL on a Claude Paseo subagent", () => {
    const env = sessionOpenEnv({
      provider: "claude",
      isSubagent: true,
      values: { ...values, subagentCacheTtl: "1h" },
    });
    expect(env[CLAUDE_SUBAGENT_CACHE_TTL_ENV]).toBe("1h");
    expect(env[CLAUDE_MAIN_CACHE_TTL_ENV]).toBe("1h");
  });

  it("adds nothing for other providers", () => {
    expect(sessionOpenEnv({ provider: "codex", isSubagent: true, values })).toEqual({});
    expect(sessionOpenEnv({ provider: "opencode", isSubagent: false, values })).toEqual({});
  });
});
