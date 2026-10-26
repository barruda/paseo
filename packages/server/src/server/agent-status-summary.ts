import { createHash } from "node:crypto";
import type pino from "pino";
import { z } from "zod";
import type { AgentStatusSummaryPayload } from "@getpaseo/protocol/messages";
import type { AgentTimelineItem } from "./agent/agent-sdk-types.js";
import { curateAgentActivity } from "./agent/activity-curator.js";
import type { AgentManager, AgentManagerEvent } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import { clampTitleWords, resolveCreateAgentTitles } from "./agent/create-agent-title.js";
import { recordLlmUsage, runLeanClaude } from "./lean-claude.js";

// CUSTOM(agent-status-summary): one line per agent saying what was asked and where the work is,
// for when you come back to a tab after looking at five others. Haiku rewrites it when you send a
// message, when a turn ends, and every few minutes of a long turn, through a lean `claude -p` call
// (see lean-claude.ts). The summary rides the agent snapshot, so every client sees it.

const MAX_USER_MESSAGES = 3;
const USER_MESSAGE_CHARS = 600;
const ACTIVITY_CHARS = 3_000;
const PREVIOUS_FIELD_CHARS = 300;
/** Lets the user message reach the timeline before the first summary of a turn. */
const TURN_START_DELAY_MS = 4_000;
const TURN_END_DELAY_MS = 2_000;
/** A long turn gets a fresh status at most this often while it runs. */
const RUNNING_REFRESH_MS = 3 * 60_000;
/** Each summary starts a `claude` process, so a burst of turn ends waits its turn. */
const MAX_CONCURRENT = 2;
const SUMMARY_MODEL = "haiku";
/**
 * CUSTOM(session-auto-rename): words a clamped title must not end on, so "Pesquisa de modelos low
 * poly" doesn't become "Pesquisa de modelos low" and "Abas do World e Árvores" not "Abas do World e".
 */
const TITLE_TRAILING_WORDS = new Set(
  (
    "a o as os e ou de do da dos das em no na nos nas por para pra com sem ao aos à às um uma " +
    "the a an and or of for to in on at by with from"
  ).split(" "),
);
const SYSTEM_PROMPT =
  'You write status cards for coding agent sessions. Reply with JSON only: {"title": "...", "topic": "...", "request": "...", "status": "...", "done": false}.';

const SummarySchema = z.object({
  title: z.string().optional(),
  topic: z.string().optional(),
  request: z.string(),
  status: z.string(),
  /** A bad `done` ("yes", "true") must not cost the whole summary, so it is read loosely. */
  done: z.unknown().optional(),
});

export type AgentStatusSummaryGenerate = (input: {
  agentId: string;
  prompt: string;
}) => Promise<Omit<AgentStatusSummaryPayload, "updatedAt">>;

/** Parses the model's reply, tolerating text or a code fence around the JSON object. */
export function parseStatusSummaryReply(text: string): z.infer<typeof SummarySchema> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`No JSON in the reply: ${text.slice(0, 200)}`);
  return SummarySchema.parse(JSON.parse(text.slice(start, end + 1)));
}

/** Haiku through `claude -p`, recording every call in the usage file. */
export function createLeanClaudeStatusGenerate(paseoHome: string): AgentStatusSummaryGenerate {
  return async ({ agentId, prompt }) => {
    const startedAt = Date.now();
    const record = (entry: Omit<Parameters<typeof recordLlmUsage>[1], "at" | "feature">) =>
      recordLlmUsage(paseoHome, {
        at: new Date().toISOString(),
        feature: "status-summary",
        ...entry,
      }).catch(() => undefined);
    try {
      const result = await runLeanClaude({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        model: SUMMARY_MODEL,
      });
      await record({
        agentId,
        ok: true,
        model: result.model,
        usage: result.usage,
        costUsd: result.costUsd,
        durationMs: Date.now() - startedAt,
      });
      const summary = parseStatusSummaryReply(result.text);
      const title = tidyGeneratedTitle(summary.title);
      return {
        ...(title ? { title } : {}),
        ...(summary.topic?.trim() ? { topic: summary.topic.trim() } : {}),
        request: summary.request,
        status: summary.status,
        ...(summary.done !== undefined ? { done: readDoneFlag(summary.done) } : {}),
        ...(result.model ? { model: result.model } : {}),
        ...(result.costUsd !== null ? { costUsd: result.costUsd } : {}),
      };
    } catch (error) {
      await record({
        agentId,
        ok: false,
        model: null,
        usage: null,
        costUsd: null,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

export interface StatusSummaryInput {
  userMessages: string[];
  activity: string;
}

export function collectStatusSummaryInput(
  timeline: readonly AgentTimelineItem[],
): StatusSummaryInput | null {
  const userIndexes: number[] = [];
  timeline.forEach((item, index) => {
    if (item.type === "user_message" && item.text.trim()) userIndexes.push(index);
  });
  if (userIndexes.length === 0) return null;
  // The first message frames the session; the last few say what is being asked now.
  const picked = new Set([userIndexes[0], ...userIndexes.slice(-MAX_USER_MESSAGES)]);
  const userMessages = [...picked].map((index) =>
    clip((timeline[index] as { text: string }).text.trim(), USER_MESSAGE_CHARS),
  );
  const tail = timeline.slice(userIndexes[userIndexes.length - 1] + 1);
  const activity = tail.length
    ? clipStart(curateAgentActivity([...tail], { labelAssistantMessages: true }), ACTIVITY_CHARS)
    : "";
  return { userMessages, activity };
}

export function buildStatusSummaryPrompt(input: {
  summaryInput: StatusSummaryInput;
  lifecycle: string;
  previous: AgentStatusSummaryPayload | null;
}): string {
  const { summaryInput, lifecycle, previous } = input;
  const lines = [
    "You keep a status card for a coding agent session. The user glances at it when switching",
    "back to this tab and needs to remember what the session is about.",
    "",
    "- title: a name for the session, 2 to 4 words, used as its tab title. A complete name, never",
    '  a phrase cut short: no trailing "de", "e", "para", "and", "of". Name the subject',
    "  (feature, bug, tool), not the activity. Keep the previous title unless the subject changed.",
    "- topic: what the session is about right now, in at most 6 words, like a tab title. It is",
    "  the only part shown without hovering, so it must read at a glance.",
    "- request: what the user is asking for right now, as a short phrase (at most 12 words).",
    "  When the latest messages change the goal, describe the new goal, not the first one.",
    "- status: where the work stands, as one short sentence (at most 18 words): what the agent",
    "  is doing or did, and what is pending or what it needs from the user.",
    // CUSTOM(worktree-pill-done)
    "- done: true when the agent says the current request is done or nearly done, so that only",
    "  the user's review, a commit or a merge is left. false while work, a question or a failure",
    "  is pending.",
    "Write them all in the language of the user's messages. No markdown inside the values.",
    'Reply with JSON only: {"title": "...", "topic": "...", "request": "...", "status": "...", "done": false}',
    "",
    `Agent state: ${lifecycle}.`,
  ];
  if (previous) {
    lines.push(
      "",
      "Previous card (update it; keep what still holds):",
      ...(previous.title ? [`title: ${clip(previous.title, PREVIOUS_FIELD_CHARS)}`] : []),
      ...(previous.topic ? [`topic: ${clip(previous.topic, PREVIOUS_FIELD_CHARS)}`] : []),
      `request: ${clip(previous.request, PREVIOUS_FIELD_CHARS)}`,
      `status: ${clip(previous.status, PREVIOUS_FIELD_CHARS)}`,
      ...(previous.done !== undefined ? [`done: ${previous.done}`] : []),
    );
  }
  lines.push("", "User messages, oldest first:");
  for (const message of summaryInput.userMessages) {
    lines.push(`<user>\n${message}\n</user>`);
  }
  lines.push(
    "",
    "Agent activity since the last user message:",
    summaryInput.activity || "(nothing yet)",
  );
  return lines.join("\n");
}

interface AgentState {
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  /** A trigger arrived while generating; run again when it finishes. */
  pending: boolean;
  lastStartedAt: number;
  lastFingerprint: string | null;
}

export interface AgentStatusSummariesOptions {
  agentManager: Pick<
    AgentManager,
    "subscribe" | "getAgent" | "getTimeline" | "setStatusSummary" | "getStatusSummary" | "setTitle"
  >;
  agentStorage: Pick<AgentStorage, "get">;
  generate: AgentStatusSummaryGenerate;
  logger: pino.Logger;
  now?: () => Date;
}

export class AgentStatusSummaries {
  private readonly agents = new Map<string, AgentState>();
  private readonly queue: Array<() => void> = [];
  private running = 0;
  private unsubscribe: (() => void) | null = null;
  private readonly now: () => Date;

  constructor(private readonly options: AgentStatusSummariesOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    this.unsubscribe = this.options.agentManager.subscribe((event) => this.handleEvent(event), {
      replayState: false,
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const state of this.agents.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.agents.clear();
    this.queue.length = 0;
  }

  private handleEvent(event: AgentManagerEvent): void {
    if (event.type !== "agent_stream") return;
    const { agentId } = event;
    switch (event.event.type) {
      case "turn_started":
        this.schedule(agentId, TURN_START_DELAY_MS);
        return;
      case "turn_completed":
      case "turn_failed":
      case "turn_canceled":
        this.schedule(agentId, TURN_END_DELAY_MS);
        return;
      case "timeline": {
        const state = this.agents.get(agentId);
        if (state && this.now().getTime() - state.lastStartedAt >= RUNNING_REFRESH_MS) {
          this.schedule(agentId, 0);
        }
        return;
      }
      default:
        return;
    }
  }

  private stateFor(agentId: string): AgentState {
    let state = this.agents.get(agentId);
    if (!state) {
      state = {
        timer: null,
        inFlight: false,
        pending: false,
        lastStartedAt: 0,
        lastFingerprint: null,
      };
      this.agents.set(agentId, state);
    }
    return state;
  }

  private schedule(agentId: string, delayMs: number): void {
    const state = this.stateFor(agentId);
    if (state.inFlight) {
      state.pending = true;
      return;
    }
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      this.enqueue(agentId);
    }, delayMs);
  }

  private enqueue(agentId: string): void {
    const state = this.stateFor(agentId);
    if (state.inFlight) {
      state.pending = true;
      return;
    }
    state.inFlight = true;
    state.lastStartedAt = this.now().getTime();
    this.queue.push(() => {
      void this.generate(agentId).finally(() => {
        this.running -= 1;
        state.inFlight = false;
        this.drain();
        if (state.pending && this.agents.get(agentId) === state) {
          state.pending = false;
          this.schedule(agentId, TURN_END_DELAY_MS);
        }
      });
    });
    this.drain();
  }

  private drain(): void {
    while (this.running < MAX_CONCURRENT && this.queue.length > 0) {
      this.running += 1;
      this.queue.shift()?.();
    }
  }

  private async generate(agentId: string): Promise<void> {
    const { agentManager, logger } = this.options;
    const agent = agentManager.getAgent(agentId);
    if (!agent || agent.internal) {
      this.agents.delete(agentId);
      return;
    }
    const summaryInput = collectStatusSummaryInput(agentManager.getTimeline(agentId));
    if (!summaryInput) return;
    // CUSTOM(agent-status-summary-persist): after a restart, the stored summary is the previous one.
    const previous =
      agentManager.getStatusSummary(agentId) ??
      (await this.options.agentStorage.get(agentId))?.statusSummary ??
      null;
    const prompt = buildStatusSummaryPrompt({
      summaryInput,
      lifecycle: agent.lifecycle,
      previous,
    });
    const state = this.stateFor(agentId);
    // The previous card is left out: it changes after every summary, the session does not.
    const fingerprint = createHash("sha1")
      .update(JSON.stringify([agent.lifecycle, summaryInput]))
      .digest("hex");
    if (fingerprint === state.lastFingerprint) return;
    try {
      const result = await this.options.generate({ agentId, prompt });
      const request = result.request.trim();
      const status = result.status.trim();
      if (!request || !status) return;
      state.lastFingerprint = fingerprint;
      agentManager.setStatusSummary(agentId, {
        ...result,
        request,
        status,
        updatedAt: this.now().toISOString(),
      });
      if (result.title) await this.maybeAutoRename(agentId, result.title, previous?.title ?? null);
    } catch (error) {
      logger.warn({ err: error, agentId }, "agent status summary failed");
    }
  }

  // CUSTOM(session-auto-rename): the summary's title names the session from its first summary on,
  // and follows it while the title is still one this feature wrote: the first message's
  // provisional title or the previous summary's title. A rename by hand (or an explicit title from
  // the CLI/MCP) matches neither, so it stays, across daemon restarts too.
  private async maybeAutoRename(
    agentId: string,
    title: string,
    previousTitle: string | null,
  ): Promise<void> {
    const { agentManager, agentStorage } = this.options;
    const current = (await agentStorage.get(agentId))?.title?.trim() || null;
    if (current === title) return;
    if (current && current !== previousTitle) {
      const firstUserText = agentManager
        .getTimeline(agentId)
        .find((item) => item.type === "user_message" && item.text.trim());
      const { provisionalTitle } = resolveCreateAgentTitles({
        initialPrompt: firstUserText?.type === "user_message" ? firstUserText.text : null,
      });
      if (current !== provisionalTitle) return;
    }
    await agentManager.setTitle(agentId, title);
  }
}

/**
 * CUSTOM(session-auto-rename): clamps a generated title to four words, then drops connector words
 * the cut left at the end.
 */
export function tidyGeneratedTitle(title: string | undefined): string | undefined {
  const words = clampTitleWords(title ?? "").split(" ");
  while (words.length > 1 && TITLE_TRAILING_WORDS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  const tidy = words
    .join(" ")
    .replace(/[\s,;:.\-–—]+$/u, "")
    .trim();
  return tidy || undefined;
}

/** CUSTOM(worktree-pill-done): `true` or `"true"`; anything else is not done. */
export function readDoneFlag(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function clipStart(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(text.length - max + 1)}`;
}
