import { randomUUID } from "node:crypto";
import type { PaseoAgentHandle } from "@getpaseo/client";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import {
  buildCriticFeedbackMessage,
  type CriticConfig,
  CRITIC_ROLE_LABEL,
  CRITIC_ROLE_VALUE,
  CRITIC_TIMELINE_KIND,
  CRITIC_TIMELINE_VERSION,
  type CriticReviewData,
  isCriticAgentLabels,
} from "@getpaseo/protocol/critic";
import type { PluginHookContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import {
  buildCriticPrompt,
  isReviewableTurn,
  isSameTurn,
  parseVerdict,
  readReviewedTurn,
  type ReviewedTurn,
  reviewRow,
  verdictOutcome,
} from "../shared/review";
import { readWorkspaceDiff } from "./diff";
import { collectEvidence } from "./evidence";
import type { CriticStore } from "./store";

type Paseo = PluginHookContext["paseo"];
type TurnEnded = PluginLifecycleEvents["agent.turn_ended"];
type PermissionRequested = PluginLifecycleEvents["agent.permission_requested"];

const HISTORY_PAGE = 400;
const CRITIC_TURN_TIMEOUT_MS = 20 * 60_000;
/** A denied permission ends the wait early; the critic then goes on, up to this many times. */
const MAX_PERMISSION_WAITS = 20;

// Claude's tools by what they may do. Paseo's own MCP tools (create agents, send prompts) are
// never the critic's business.
const CLAUDE_WRITE_TOOLS = [
  "Bash",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "Task",
  "Agent",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "mcp__paseo",
];
const CLAUDE_READ_TOOLS = ["Read", "Glob", "Grep", "LS"];

function criticAgentConfig(config: CriticConfig) {
  const base = {
    provider: `${config.provider}/${config.model}`,
    ...(config.thinkingOptionId ? { thinkingOptionId: config.thinkingOptionId } : {}),
  };
  if (config.provider !== "claude") return base;
  const disallowedTools =
    config.tools === "off" ? [...CLAUDE_WRITE_TOOLS, ...CLAUDE_READ_TOOLS] : CLAUDE_WRITE_TOOLS;
  return { ...base, modeId: "default", options: { disallowedTools } };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface RunningReview {
  turn: ReviewedTurn;
}

export class CriticLoop {
  /** Critic agents this process created; others are recognized by their label. */
  private readonly criticIds = new Set<string>();
  /** Per-request mode: the critic of the request each reviewed agent is on. */
  private readonly requestCritics = new Map<string, string>();
  private readonly running = new Map<string, RunningReview>();

  constructor(
    private readonly store: CriticStore,
    private readonly paseo: () => Paseo,
  ) {}

  onTurnEnded(event: TurnEnded): void {
    if (event.outcome.kind !== "completed") return;
    if (this.criticIds.has(event.agent.id)) return;
    void this.review(event).catch((error: unknown) =>
      console.error(`[critic] review of ${event.agent.id} failed`, error),
    );
  }

  /** Critics only read: any permission they ask for is denied. */
  onPermissionRequested(event: PermissionRequested): void {
    void this.denyCriticPermission(event).catch((error: unknown) =>
      console.error(`[critic] could not answer a permission of ${event.agent.id}`, error),
    );
  }

  private async isCritic(agentId: string, parentAgentId: string | null): Promise<boolean> {
    if (this.criticIds.has(agentId)) return true;
    if (parentAgentId === null) return false;
    const snapshot = await this.paseo().agents.ref(agentId).refresh();
    return snapshot !== null && isCriticAgentLabels(snapshot.agent.labels);
  }

  private async denyCriticPermission(event: PermissionRequested): Promise<void> {
    if (!(await this.isCritic(event.agent.id, event.agent.parentAgentId))) return;
    await this.paseo()
      .agents.ref(event.agent.id)
      .respondToPermission({
        requestId: event.request.id,
        response: {
          behavior: "deny",
          message:
            "Refused: a critic changes nothing and does not read outside the workspace. Judge from what you can read; if your verdict depends on what you could not open, answer unverified.",
        },
      });
  }

  private async readTurn(agent: PaseoAgentHandle): Promise<ReviewedTurn> {
    const page = await agent.timeline.refetch({ direction: "tail", limit: HISTORY_PAGE });
    const items: AgentTimelineItem[] = page.entries.map((entry) => entry.item);
    return readReviewedTurn(items);
  }

  private async review(event: TurnEnded): Promise<void> {
    const agentId = event.agent.id;
    const { config } = await this.store.get(agentId);
    if (!config.enabled) return;
    if (await this.isCritic(agentId, event.agent.parentAgentId)) return;
    if (this.running.has(agentId)) return;

    const paseo = this.paseo();
    const agent = paseo.agents.ref(agentId);
    const turn = await this.readTurn(agent);
    if (!isReviewableTurn(turn)) return;

    this.running.set(agentId, { turn });
    const rowId = `critic-${randomUUID()}`;
    const startedAt = new Date();
    const base = {
      round: turn.round,
      maxRounds: config.maxRounds,
      answer: turn.answer,
      criticAgentId: null as string | null,
      model: `${config.provider}/${config.model}`,
      startedAt: startedAt.toISOString(),
    };
    const publish = (data: CriticReviewData) =>
      agent.timeline.append({
        type: "plugin",
        id: rowId,
        kind: CRITIC_TIMELINE_KIND,
        version: CRITIC_TIMELINE_VERSION,
        data,
      });
    const settle = (
      status: CriticReviewData["status"],
      fields: { feedback?: string | null; error?: string | null } = {},
    ) =>
      publish(
        reviewRow({
          ...base,
          status,
          feedback: fields.feedback ?? null,
          error: fields.error ?? null,
          durationMs: Date.now() - startedAt.getTime(),
        }),
      );

    try {
      await publish(
        reviewRow({ ...base, status: "reviewing", feedback: null, error: null, durationMs: null }),
      );
      const diff = config.includeDiff ? await readWorkspaceDiff(event.agent.cwd) : null;
      const critic = await this.criticFor({ agentId, cwd: event.agent.cwd, config, turn });
      base.criticAgentId = critic.handle.id;
      await publish(
        reviewRow({ ...base, status: "reviewing", feedback: null, error: null, durationMs: null }),
      );

      const evidence = await collectEvidence(turn.answer, event.agent.cwd);
      const prompt = buildCriticPrompt({
        config,
        turn,
        diff,
        evidence,
        continuing: critic.continuing,
      });
      const reply = await this.ask(critic, prompt, config, evidence.images);

      const current = await this.readTurn(agent);
      const latest = await this.store.get(agentId);
      if (!isSameTurn(turn, current) || !latest.config.enabled) {
        await settle("canceled");
        return;
      }
      if (reply.error !== null) {
        await settle("failed", { error: reply.error });
        return;
      }
      const verdict = parseVerdict(reply.text);
      if (verdict === null) {
        await settle("failed", {
          error: "The critic ended without a verdict block.",
          feedback: reply.text || null,
        });
        return;
      }
      const outcome = verdictOutcome({
        verdict,
        reply: reply.text,
        round: turn.round,
        maxRounds: config.maxRounds,
      });
      await settle(outcome.status, { feedback: outcome.feedback });
      if (outcome.status === "rejected" && outcome.feedback) {
        await agent.send(
          buildCriticFeedbackMessage({ round: turn.round, feedback: outcome.feedback }),
        );
      }
    } catch (error) {
      await settle("failed", { error: errorText(error) }).catch(() => undefined);
      throw error;
    } finally {
      this.running.delete(agentId);
    }
  }

  private async existingCritic(
    agentId: string,
    config: CriticConfig,
    turn: ReviewedTurn,
  ): Promise<string | null> {
    if (config.mode === "persistent") return this.store.persistentCritic(agentId);
    if (turn.round === 1) return null;
    return this.requestCritics.get(agentId) ?? null;
  }

  /** The critic for this round: reused within a request (or for good, when persistent). */
  private async criticFor(input: {
    agentId: string;
    cwd: string;
    config: CriticConfig;
    turn: ReviewedTurn;
  }): Promise<{ handle: PaseoAgentHandle; continuing: boolean; isNew: boolean }> {
    const paseo = this.paseo();
    const { agentId, config, turn } = input;
    const existingId = await this.existingCritic(agentId, config, turn);
    if (existingId) {
      const handle = paseo.agents.ref(existingId);
      const snapshot = await handle.refresh().catch(() => null);
      if (snapshot && !snapshot.agent.archivedAt) {
        this.criticIds.add(existingId);
        return { handle, continuing: true, isNew: false };
      }
    }
    // A request's critic is done once the user moves on.
    const previous = this.requestCritics.get(agentId);
    if (config.mode === "per-request" && previous) {
      this.requestCritics.delete(agentId);
      await paseo.agents
        .ref(previous)
        .archive()
        .catch(() => undefined);
    }
    const handle = await paseo.agents.create({
      cwd: input.cwd,
      parent: agentId,
      title: "Critic",
      config: criticAgentConfig(config),
      labels: { [CRITIC_ROLE_LABEL]: CRITIC_ROLE_VALUE },
    });
    this.criticIds.add(handle.id);
    if (config.mode === "persistent") await this.store.setPersistentCritic(agentId, handle.id);
    else this.requestCritics.set(agentId, handle.id);
    return { handle, continuing: false, isNew: true };
  }

  private async ask(
    critic: { handle: PaseoAgentHandle; isNew: boolean },
    prompt: string,
    config: CriticConfig,
    evidenceImages: readonly { data: string; mimeType: string }[],
  ): Promise<{ text: string; error: string | null }> {
    const references = critic.isNew
      ? config.images.map(({ data, mimeType }) => ({ data, mimeType }))
      : [];
    const images = [...references, ...evidenceImages];
    let result = await critic.handle.run(prompt, {
      ...(images.length > 0 ? { images } : {}),
      timeoutMs: CRITIC_TURN_TIMEOUT_MS,
    });
    for (let waits = 0; result.status === "permission" && waits < MAX_PERMISSION_WAITS; waits++) {
      result = await critic.handle.waitForFinish(CRITIC_TURN_TIMEOUT_MS);
    }
    if (result.status === "idle") return { text: result.lastMessage ?? "", error: null };
    return {
      text: result.lastMessage ?? "",
      error: result.error ?? `The critic's turn ended as ${result.status}.`,
    };
  }
}
