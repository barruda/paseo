import { describe, expect, it } from "vitest";
import { resolveClientSlashCommand } from "./index";
import { clientSlashCommandArchivesAgent } from "./clear-keeps-agent";

function archives(text: string): boolean {
  const command = resolveClientSlashCommand({ text, hasAttachments: false });
  if (!command) {
    throw new Error(`No client slash command for ${text}`);
  }
  return clientSlashCommandArchivesAgent(command);
}

describe("clientSlashCommandArchivesAgent", () => {
  it("keeps the agent on /clear and /new", () => {
    expect(archives("/clear")).toBe(false);
    expect(archives("/new")).toBe(false);
  });

  it("archives the agent on /exit and its aliases", () => {
    expect(archives("/exit")).toBe(true);
    expect(archives("/quit")).toBe(true);
    expect(archives("/q")).toBe(true);
  });
});
