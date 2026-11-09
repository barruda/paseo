// CUSTOM(skills-loaded): finds the session files the "Skills and MCPs Loaded" tab reads, and the
// user's own skill folders. Everything that touches the disk lives here.

import { createReadStream } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import { parseFrontmatter } from "../resolve/frontmatter.ts";
import { dirsUpToRepoRoot } from "../resolve/repo-root.ts";
import { parseSessionMeta } from "./codex.ts";

export interface SessionFile {
  path: string;
  mtimeMs: number;
  size: number;
}

async function statFile(file: string): Promise<SessionFile | null> {
  try {
    const info = await stat(file);
    return info.isFile() ? { path: file, mtimeMs: info.mtimeMs, size: info.size } : null;
  } catch {
    return null;
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** Streams a file line by line; `onLine` returning `false` stops early. */
export async function forEachLine(file: string, onLine: (line: string) => boolean | void): Promise<void> {
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (onLine(line) === false) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

async function firstLine(file: string): Promise<string | null> {
  let result: string | null = null;
  await forEachLine(file, (line) => {
    result = line;
    return false;
  });
  return result;
}

// ---------------------------------------------------------------------------------------------
// Claude Code

const PROJECT_DIR_LENGTH_CAP = 200;

/**
 * Claude Code's project folder name for a cwd: every non-alphanumeric character becomes `-`,
 * long names are capped with a hash. Port of `encode` in the daemon's
 * `providers/claude/project-dir.ts`, which ports the SDK.
 */
export function encodeClaudeProject(cwd: string): string {
  const replaced = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  if (replaced.length <= PROJECT_DIR_LENGTH_CAP) return replaced;
  let hash = 0;
  for (let i = 0; i < cwd.length; i++) hash = ((hash << 5) - hash + cwd.charCodeAt(i)) | 0;
  return `${replaced.slice(0, PROJECT_DIR_LENGTH_CAP)}-${Math.abs(hash).toString(36)}`;
}

async function canonical(cwd: string): Promise<string> {
  try {
    return await realpath(cwd);
  } catch {
    return cwd;
  }
}

/**
 * Where to look for a known session: the daemon's `CLAUDE_CONFIG_DIR` first, then the user's
 * personal (`~/.claude-personal`) and default (`~/.claude`) folders.
 */
export function claudeConfigDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  const dirs = [env.CLAUDE_CONFIG_DIR, path.join(home, ".claude-personal"), path.join(home, ".claude")];
  return [...new Set(dirs.filter((dir): dir is string => Boolean(dir)))];
}

/** The folder Claude Code itself uses for new sessions of this daemon. */
export function claudeActiveConfigDir(env: NodeJS.ProcessEnv, home: string): string {
  return env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
}

export async function findClaudeTranscript(input: {
  sessionId: string;
  cwd: string;
  configDirs: readonly string[];
}): Promise<SessionFile | null> {
  const fileName = `${input.sessionId}.jsonl`;
  const project = encodeClaudeProject(await canonical(input.cwd));
  for (const dir of input.configDirs) {
    const found = await statFile(path.join(dir, "projects", project, fileName));
    if (found) return found;
  }
  // A resumed session keeps writing in the folder where it started.
  for (const dir of input.configDirs) {
    const projects = path.join(dir, "projects");
    for (const folder of await listDir(projects)) {
      const found = await statFile(path.join(projects, folder, fileName));
      if (found) return found;
    }
  }
  return null;
}

/** The project's session transcripts, newest first. Subagent transcripts live in subfolders. */
export async function claudeProjectTranscripts(input: { cwd: string; configDir: string }): Promise<SessionFile[]> {
  const folder = path.join(input.configDir, "projects", encodeClaudeProject(await canonical(input.cwd)));
  const names = (await listDir(folder)).filter((name) => name.endsWith(".jsonl"));
  const files = await Promise.all(names.map((name) => statFile(path.join(folder, name))));
  return files
    .filter((file): file is SessionFile => file !== null && file.size > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * The names of the skills in the user's own folders: Claude's `<config>/skills`,
 * `~/.agents/skills`, and `.claude/skills` / `.agents/skills` from cwd up to the repo root. Both
 * the folder name and the frontmatter `name` count, since either can be what the session lists.
 */
export async function userSkillNames(input: { cwd: string; configDir: string; home: string }): Promise<Set<string>> {
  const dirs = [path.join(input.configDir, "skills"), path.join(input.home, ".agents", "skills")];
  for (const dir of await dirsUpToRepoRoot(input.cwd)) {
    dirs.push(path.join(dir, ".claude", "skills"), path.join(dir, ".agents", "skills"));
  }
  const names = new Set<string>();
  await Promise.all(
    dirs.map(async (dir) => {
      for (const child of await listDir(dir)) {
        let raw: string;
        try {
          raw = await readFile(path.join(dir, child, "SKILL.md"), "utf8");
        } catch {
          continue;
        }
        names.add(child);
        const name = parseFrontmatter(raw).frontmatter.name;
        if (name) names.add(name);
      }
    }),
  );
  return names;
}

// ---------------------------------------------------------------------------------------------
// Codex

export function codexHomeDir(env: NodeJS.ProcessEnv, home: string): string {
  return env.CODEX_HOME || path.join(home, ".codex");
}

const NUMBERED = /^\d+$/;

/** `sessions/YYYY/MM/DD` day folders, newest first. */
async function codexDayDirs(codexHome: string): Promise<string[]> {
  const root = path.join(codexHome, "sessions");
  const newestFirst = (names: string[]) => names.filter((name) => NUMBERED.test(name)).sort().reverse();
  const days: string[] = [];
  for (const year of newestFirst(await listDir(root))) {
    for (const month of newestFirst(await listDir(path.join(root, year)))) {
      for (const day of newestFirst(await listDir(path.join(root, year, month)))) {
        days.push(path.join(root, year, month, day));
      }
    }
  }
  return days;
}

async function rolloutsIn(dir: string): Promise<SessionFile[]> {
  const names = (await listDir(dir)).filter((name) => name.startsWith("rollout-") && name.endsWith(".jsonl"));
  const files = await Promise.all(names.map((name) => statFile(path.join(dir, name))));
  return files
    .filter((file): file is SessionFile => file !== null && file.size > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function findCodexRollout(input: { sessionId: string; codexHome: string }): Promise<SessionFile | null> {
  const suffix = `-${input.sessionId}.jsonl`;
  for (const day of await codexDayDirs(input.codexHome)) {
    const name = (await listDir(day)).find((file) => file.startsWith("rollout-") && file.endsWith(suffix));
    if (name) return statFile(path.join(day, name));
  }
  return null;
}

/**
 * The newest rollouts that ran in `cwd`, newest first. Reads only first lines, and gives up after
 * `scanLimit` rollouts so a long history costs a bounded amount.
 */
export async function codexRolloutsForCwd(input: {
  cwd: string;
  codexHome: string;
  scanLimit?: number;
}): Promise<SessionFile[]> {
  const wanted = new Set([path.resolve(input.cwd), await canonical(input.cwd)]);
  const limit = input.scanLimit ?? 300;
  const matches: SessionFile[] = [];
  let scanned = 0;
  for (const day of await codexDayDirs(input.codexHome)) {
    for (const file of await rolloutsIn(day)) {
      if (scanned++ >= limit) return matches;
      const line = await firstLine(file.path);
      const meta = line ? parseSessionMeta(line) : null;
      if (meta && wanted.has(path.resolve(meta.cwd))) matches.push(file);
    }
    if (matches.length >= 3) return matches;
  }
  return matches;
}

export async function readCodexConfig(codexHome: string): Promise<string> {
  try {
    return await readFile(path.join(codexHome, "config.toml"), "utf8");
  } catch {
    return "";
  }
}
