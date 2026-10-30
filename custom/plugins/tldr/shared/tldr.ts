import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** What the pill sends to the agent until the user saves another message. */
export const TLDR_PROMPT = "TLDR";

/** The message the pill and `/tldr` send, edited from the chevron beside the pill. */
export const tldrSettings = defineSettings({
  id: "prompt",
  scope: "host",
  version: 1,
  schema: z.object({
    prompt: z.string().trim().min(1, "Type the message to send").default(TLDR_PROMPT),
  }),
});

/** The saved message from a settings read; the default while the stored file is invalid. */
export function tldrPromptFrom(read: { status: string; values?: unknown }): string {
  if (read.status !== "ready") return TLDR_PROMPT;
  const parsed = tldrSettings.schema.safeParse(read.values);
  return parsed.success ? parsed.data.prompt : TLDR_PROMPT;
}

export interface TldrAgent {
  id: string;
  workspaceId?: string | null;
  status: string;
  archivedAt?: string | null;
}

/** The workspace the agent's TLDR pill belongs to, or null when it gets no pill. */
export function tldrPillWorkspace(agent: TldrAgent): string | null {
  if (!agent.workspaceId || agent.archivedAt || agent.status === "closed") return null;
  return agent.workspaceId;
}
