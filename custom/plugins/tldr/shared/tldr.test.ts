import { describe, expect, it } from "vitest";
import { TLDR_PROMPT, tldrPillWorkspace, tldrPromptFrom } from "./tldr";

describe("tldrPillWorkspace", () => {
  it("returns the workspace of an open agent", () => {
    expect(tldrPillWorkspace({ id: "a", workspaceId: "w", status: "idle" })).toBe("w");
  });

  it("skips agents without a workspace, archived, or closed", () => {
    expect(tldrPillWorkspace({ id: "a", workspaceId: null, status: "idle" })).toBeNull();
    expect(
      tldrPillWorkspace({ id: "a", workspaceId: "w", status: "idle", archivedAt: "2026-10-19" }),
    ).toBeNull();
    expect(tldrPillWorkspace({ id: "a", workspaceId: "w", status: "closed" })).toBeNull();
  });
});

describe("tldrPromptFrom", () => {
  it("returns the saved message", () => {
    expect(tldrPromptFrom({ status: "ready", values: { prompt: "  Resuma em 3 linhas " } })).toBe(
      "Resuma em 3 linhas",
    );
  });

  it("falls back to TLDR before anything is saved or when the stored file is invalid", () => {
    expect(tldrPromptFrom({ status: "ready", values: {} })).toBe(TLDR_PROMPT);
    expect(tldrPromptFrom({ status: "ready", values: { prompt: "" } })).toBe(TLDR_PROMPT);
    expect(tldrPromptFrom({ status: "invalid" })).toBe(TLDR_PROMPT);
  });
});
