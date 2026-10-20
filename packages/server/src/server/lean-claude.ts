import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// CUSTOM(llm-usage): one `claude -p` call with no tools, settings, MCP servers, CLAUDE.md or saved
// session, on the daemon's own Claude login. About 1k tokens of overhead, where a full agent
// session costs 20k-40k. Every call is recorded in $PASEO_HOME/custom-llm-usage.jsonl; read the
// totals with `node custom/llm-usage.mjs`.

export const LLM_USAGE_FILE = "custom-llm-usage.jsonl";
const DEFAULT_TIMEOUT_MS = 90_000;

export interface LeanClaudeUsage {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export interface LeanClaudeResult {
  text: string;
  /** The model that answered, e.g. `claude-haiku-5-5`. */
  model: string | null;
  usage: LeanClaudeUsage;
  /** What the call would cost on the API, at list price. Billed to the subscription. */
  costUsd: number | null;
}

export interface LlmUsageEntry {
  at: string;
  feature: string;
  agentId: string | null;
  ok: boolean;
  model: string | null;
  usage: LeanClaudeUsage | null;
  costUsd: number | null;
  durationMs: number;
  error?: string;
}

interface ClaudeJsonResult {
  is_error?: boolean;
  result?: unknown;
  total_cost_usd?: unknown;
  usage?: Record<string, unknown>;
  modelUsage?: Record<string, unknown>;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parseLeanClaudeOutput(stdout: string): LeanClaudeResult {
  const result = JSON.parse(stdout) as ClaudeJsonResult;
  const text = typeof result.result === "string" ? result.result.trim() : "";
  if (result.is_error || !text) throw new Error(text || "The model returned nothing.");
  const usage = result.usage ?? {};
  return {
    text,
    model: Object.keys(result.modelUsage ?? {})[0] ?? null,
    usage: {
      inputTokens: count(usage.input_tokens),
      cacheCreationTokens: count(usage.cache_creation_input_tokens),
      cacheReadTokens: count(usage.cache_read_input_tokens),
      outputTokens: count(usage.output_tokens),
    },
    costUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : null,
  };
}

export function runLeanClaude(input: {
  prompt: string;
  systemPrompt: string;
  model: string;
  timeoutMs?: number;
}): Promise<LeanClaudeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        "-p",
        "--model",
        input.model,
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--tools",
        "",
        "--no-session-persistence",
        "--system-prompt",
        input.systemPrompt,
        "--output-format",
        "json",
      ],
      // A neutral cwd so no project CLAUDE.md is picked up.
      { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"], env: process.env },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        resolve(parseLeanClaudeOutput(stdout));
      } catch (error) {
        const detail = stderr.trim() || (code === null ? "timed out" : `exit ${code}`);
        reject(new Error(error instanceof Error && stdout ? error.message : detail));
      }
    });
    child.stdin.end(input.prompt);
  });
}

export async function recordLlmUsage(paseoHome: string, entry: LlmUsageEntry): Promise<void> {
  await appendFile(path.join(paseoHome, LLM_USAGE_FILE), `${JSON.stringify(entry)}\n`);
}
