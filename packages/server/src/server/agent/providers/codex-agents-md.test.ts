import { describe, expect, it } from "vitest";
import { CODEX_AGENTS_MD_ENV, codexAgentsMdConfig } from "./codex-agents-md";

describe("codexAgentsMdConfig", () => {
  it("turns off the repo's AGENTS.md for none", () => {
    expect(codexAgentsMdConfig({ [CODEX_AGENTS_MD_ENV]: "none" })).toEqual({
      project_doc_max_bytes: 0,
    });
  });

  it("leaves the config alone otherwise", () => {
    expect(codexAgentsMdConfig(undefined)).toEqual({});
    expect(codexAgentsMdConfig({})).toEqual({});
    expect(codexAgentsMdConfig({ [CODEX_AGENTS_MD_ENV]: "project" })).toEqual({});
  });
});
