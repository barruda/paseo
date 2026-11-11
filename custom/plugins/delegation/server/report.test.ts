import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DELEGATION_MARKER } from "../shared/policy";
import { buildReport, priceUsage } from "./report";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const NOW = Date.parse("2026-11-11T12:00:00Z");

function assistant(input: {
  id: string;
  model: string;
  cacheRead: number;
  output: number;
  sidechain?: boolean;
  tools?: { name: string; model?: string }[];
}): string {
  return JSON.stringify({
    type: "assistant",
    requestId: `req-${input.id}`,
    isSidechain: input.sidechain ?? false,
    message: {
      id: input.id,
      model: input.model,
      usage: {
        input_tokens: 0,
        cache_read_input_tokens: input.cacheRead,
        output_tokens: input.output,
      },
      content: (input.tools ?? []).map((tool) => ({
        type: "tool_use",
        id: `${input.id}-${tool.name}`,
        name: tool.name,
        input: tool.model ? { model: tool.model } : {},
      })),
    },
  });
}

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "delegation-report-"));
  roots.push(root);
  const paseoHome = path.join(root, "paseo");
  const claudeDir = path.join(root, "claude");
  const agentsDir = path.join(paseoHome, "agents", "proj");
  const projectDir = path.join(claudeDir, "projects", "-proj");
  await mkdir(agentsDir, { recursive: true });
  await mkdir(path.join(projectDir, "s1", "subagents"), { recursive: true });
  const agent = (id: string, sessionId: string, model: string, delegated: boolean, at: string) =>
    writeFile(
      path.join(agentsDir, `${id}.json`),
      JSON.stringify({
        id,
        provider: "claude",
        cwd: "/proj",
        title: id,
        lastActivityAt: at,
        config: { model, systemPrompt: delegated ? `${DELEGATION_MARKER}\n...` : undefined },
        persistence: { sessionId },
      }),
    );
  await agent("delegated", "s1", "claude-opus-5-5", true, "2026-11-11T10:00:00Z");
  await agent("plain", "s2", "claude-opus-5-5", false, "2026-11-10T10:00:00Z");
  await agent("sonnet", "s3", "claude-sonnet-5-5", false, "2026-11-10T10:00:00Z");
  await agent("old", "s4", "claude-opus-5-5", false, "2026-09-01T10:00:00Z");
  await agent("lost", "s5", "claude-opus-5-5", false, "2026-11-10T11:00:00Z");
  const call = assistant({
    id: "m1",
    model: "claude-opus-5-5",
    cacheRead: 100_000,
    output: 1000,
    tools: [{ name: "Agent", model: "sonnet" }],
  });
  await writeFile(
    path.join(projectDir, "s1.jsonl"),
    // The same request twice (one line per content block) counts once.
    [
      call,
      call,
      assistant({
        id: "m2",
        model: "claude-opus-5-5",
        cacheRead: 50_000,
        output: 0,
        tools: [{ name: "SendMessage" }],
      }),
    ].join("\n"),
  );
  await writeFile(
    path.join(projectDir, "s1", "subagents", "agent-a.jsonl"),
    assistant({
      id: "x1",
      model: "claude-sonnet-5-5",
      cacheRead: 1_000_000,
      output: 0,
      sidechain: true,
    }),
  );
  await writeFile(
    path.join(projectDir, "s2.jsonl"),
    assistant({ id: "m3", model: "claude-opus-5-5", cacheRead: 300_000, output: 0 }),
  );
  return { paseoHome, claudeDir };
}

describe("buildReport", () => {
  it("splits Opus sessions by the rule and prices main and subagent work", async () => {
    const env = await setup();
    const report = await buildReport({ days: 7, now: NOW, ...env });
    expect(report.delegated).toMatchObject({
      sessions: 1,
      missing: 0,
      turns: 2,
      contextPerTurn: 75_000,
      agentCalls: 1,
      cheapAgentCalls: 1,
    });
    expect(report.delegated.mainCost).toBeCloseTo(0.15 * 0.2 + 0.001 * 20);
    expect(report.delegated.subagentCost).toBeCloseTo(0.1);
    // Sonnet sessions and sessions older than the period stay out; a lost transcript is counted.
    expect(report.other).toMatchObject({
      sessions: 2,
      missing: 1,
      turns: 1,
      contextPerTurn: 300_000,
    });
    expect(report.sessions.map((session) => session.agentId)).toEqual(["delegated", "plain"]);
    expect(report.sessions[0]).toMatchObject({ fixMessages: 1, delegated: true });
  });
});

describe("priceUsage", () => {
  it("prices by model family", () => {
    const usage = { input: 1e6, cacheRead: 0, cacheWrite: 0, output: 1e6 };
    expect(priceUsage("claude-opus-5-5", usage)).toBe(24);
    expect(priceUsage("claude-sonnet-5-5", usage)).toBe(12);
    expect(priceUsage("unknown", usage)).toBe(0);
  });
});
