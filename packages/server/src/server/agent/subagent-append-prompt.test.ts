import { describe, expect, it } from "vitest";
import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { SUBAGENT_APPEND_PROMPT_ENV, withSubagentAppendPrompt } from "./subagent-append-prompt.js";

const base: AgentSessionConfig = { provider: "claude", cwd: "/tmp/x" };

describe("withSubagentAppendPrompt", () => {
  it("leaves the config alone without the env var", () => {
    expect(withSubagentAppendPrompt(base, {})).toBe(base);
    expect(withSubagentAppendPrompt(base, undefined)).toBe(base);
    expect(withSubagentAppendPrompt(base, { [SUBAGENT_APPEND_PROMPT_ENV]: "  " })).toBe(base);
  });

  it("sets the daemon append when there is none", () => {
    const next = withSubagentAppendPrompt(base, { [SUBAGENT_APPEND_PROMPT_ENV]: " Report. " });
    expect(next.daemonAppendSystemPrompt).toBe("Report.");
    expect(base.daemonAppendSystemPrompt).toBeUndefined();
  });

  it("joins after an existing daemon append with a blank line", () => {
    const next = withSubagentAppendPrompt(
      { ...base, daemonAppendSystemPrompt: "Daemon rule." },
      { [SUBAGENT_APPEND_PROMPT_ENV]: "Report." },
    );
    expect(next.daemonAppendSystemPrompt).toBe("Daemon rule.\n\nReport.");
  });
});
