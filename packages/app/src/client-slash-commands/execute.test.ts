// CUSTOM(assistant-desk)
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { runClientSlashCommand, type ClientSlashCommandEffects } from "./execute";
import { resolveClientSlashCommand } from "./index";

function command(text: string) {
  const resolved = resolveClientSlashCommand({ text, hasAttachments: false });
  if (!resolved) throw new Error(`No client slash command for ${text}`);
  return resolved;
}

const draftTarget: WorkspaceTabTarget = {
  kind: "draft",
  draftId: "draft-1",
  setup: {
    provider: "claude",
    cwd: "/repo",
    modeId: null,
    model: null,
    thinkingOptionId: null,
    featureValues: {},
  },
};

function effects() {
  const calls: string[] = [];
  const implementation: ClientSlashCommandEffects = {
    detachFromLayout: () => calls.push("detach"),
    buildDraftTarget: () => draftTarget,
    retargetCurrentTab: (target) => calls.push(`retarget:${target.kind}`),
    closeCurrentTab: () => calls.push("close"),
    archiveAgent: async () => {
      calls.push("archive");
    },
  };
  return { calls, implementation };
}

describe("runClientSlashCommand", () => {
  it("closes the tab and archives the agent once on /exit", async () => {
    const { calls, implementation } = effects();
    await runClientSlashCommand(command("/exit"), implementation);
    expect(calls).toEqual(["detach", "close", "archive"]);
  });

  it("leaves the tab close to /clear, turning it into a draft and keeping the agent", async () => {
    const { calls, implementation } = effects();
    await runClientSlashCommand(command("/clear"), implementation);
    expect(calls).toEqual(["detach", "retarget:draft"]);
  });

  it("ends with the agent archived before the command resolves", async () => {
    const archiveAgent = vi.fn(async () => {});
    await runClientSlashCommand(command("/q"), {
      detachFromLayout: () => {},
      buildDraftTarget: () => draftTarget,
      retargetCurrentTab: () => {},
      closeCurrentTab: () => {},
      archiveAgent,
    });
    expect(archiveAgent).toHaveBeenCalledTimes(1);
  });
});
