import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PiModelsReadOutput, PiModelsWriteOutput } from "@getpaseo/protocol/pi-models";
import { listModels } from "./pi-cli";

// Pi reads `<agent-dir>/models.json` again when a session opens `/model` or starts, so a write
// reaches new agents without restarting anything. The file holds keys: keep it 0600.

export function resolvePiAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) return resolve(homedir(), configured.slice(2));
  return resolve(configured);
}

export function modelsPath(): string {
  return join(resolvePiAgentDir(), "models.json");
}

function revisionOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function readText(path: string): Promise<{ exists: boolean; text: string }> {
  try {
    return { exists: true, text: await readFile(path, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, text: "" };
    throw error;
  }
}

export async function readModelsFile(): Promise<PiModelsReadOutput> {
  const path = modelsPath();
  const { exists, text } = await readText(path);
  return { path, exists, text, revision: revisionOf(text), listing: await listModels() };
}

/** Returns the reason `text` is not a models.json Pi can load, or null. */
export function validateModelsText(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return "The file must be a JSON object.";
  const providers = (parsed as { providers?: unknown }).providers;
  if (providers !== undefined && (typeof providers !== "object" || Array.isArray(providers)))
    return '"providers" must be an object keyed by provider id.';
  return null;
}

export async function writeModelsFile(input: {
  text: string;
  baseRevision: string;
}): Promise<PiModelsWriteOutput> {
  const invalid = validateModelsText(input.text);
  if (invalid) return { status: "invalid", message: invalid };
  const path = modelsPath();
  const current = await readText(path);
  if (revisionOf(current.text) !== input.baseRevision)
    return { status: "conflict", file: await readModelsFile() };
  await mkdir(dirname(path), { recursive: true });
  const text = input.text.endsWith("\n") ? input.text : `${input.text}\n`;
  const temp = `${path}.paseo-${process.pid}.tmp`;
  await writeFile(temp, text, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, path);
  return { status: "saved", file: await readModelsFile() };
}
