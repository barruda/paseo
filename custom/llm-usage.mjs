#!/usr/bin/env node
// Totals the cheap-model calls made by the custom status line (and the old TLDR pill).
// Each call is a line in $PASEO_HOME/custom-llm-usage.jsonl (see
// packages/server/src/server/lean-claude.ts). Costs are API list prices; the calls are billed to
// the Claude subscription, so they spend its limits, not money.
//
//   node custom/llm-usage.mjs [--home ~/.paseo] [--days 7]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const homes = args.includes("--home")
  ? [option("--home").replace(/^~/, homedir())]
  : [path.join(homedir(), ".paseo"), path.join(homedir(), ".paseo-telus")];
const days = Number(option("--days", "7"));
const since = Date.now() - days * 86_400_000;

for (const home of homes) {
  let lines;
  try {
    lines = readFileSync(path.join(home, "custom-llm-usage.jsonl"), "utf8").split("\n");
  } catch {
    console.log(`${home}: no calls recorded yet`);
    continue;
  }
  const rows = new Map();
  const models = new Set();
  for (const line of lines) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if (Date.parse(entry.at) < since) continue;
    const day = entry.at.slice(0, 10);
    const key = `${day}  ${entry.feature}`;
    const row = rows.get(key) ?? { calls: 0, failed: 0, tokens: 0, cost: 0, ms: 0 };
    row.calls += 1;
    if (!entry.ok) row.failed += 1;
    const usage = entry.usage ?? {};
    row.tokens +=
      (usage.inputTokens ?? 0) +
      (usage.cacheCreationTokens ?? 0) +
      (usage.cacheReadTokens ?? 0) +
      (usage.outputTokens ?? 0);
    row.cost += entry.costUsd ?? 0;
    row.ms += entry.durationMs ?? 0;
    if (entry.model) models.add(entry.model);
    rows.set(key, row);
  }
  console.log(`\n${home} (last ${days} days) - models: ${[...models].join(", ") || "none"}`);
  console.log("day         feature          calls  failed     tokens   cost (USD)  avg s");
  let total = 0;
  for (const [key, row] of [...rows].sort(([a], [b]) => a.localeCompare(b))) {
    const [day, feature] = key.split("  ");
    total += row.cost;
    console.log(
      `${day}  ${feature.padEnd(15)} ${String(row.calls).padStart(6)} ${String(row.failed).padStart(7)} ${String(row.tokens).padStart(10)}   ${row.cost.toFixed(4).padStart(10)}  ${(row.ms / row.calls / 1000).toFixed(1).padStart(5)}`,
    );
  }
  console.log(`total: $${total.toFixed(4)}`);
}
