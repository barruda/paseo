import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DelegationEntry } from "./tracker";

// One line per session that started with the rule, for the evaluation tab to come: it compares
// these sessions with the rest. Kept outside PASEO_HOME so both daemons write to one file.
// `PASEO_DELEGATION_LOG` moves it (tests).

export function sessionLogPath(): string {
  return (
    process.env.PASEO_DELEGATION_LOG ??
    path.join(os.homedir(), ".local/state/paseo-delegation/sessions.jsonl")
  );
}

export async function logDelegatedSession(input: {
  agentId: string;
  cwd: string;
  entry: DelegationEntry;
  file?: string;
}): Promise<void> {
  const file = input.file ?? sessionLogPath();
  const line = {
    at: new Date(input.entry.at).toISOString(),
    agentId: input.agentId,
    cwd: input.cwd,
    paseoHome: process.env.PASEO_HOME ?? null,
    mainModel: input.entry.mainModel,
    ...input.entry.card,
  };
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(line)}\n`);
}
