// CUSTOM(workspace-content-search): text search across a workspace's files. `git grep` needs nothing
// new on the host, unlike ripgrep: it skips ignored and binary files in a repo, and `--no-index`
// covers plain folders.
import { runGitCommand } from "./run-git-command.js";

const DEFAULT_LIMIT = 200;
const MAX_LINE_LENGTH = 300;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const NO_MATCHES_EXIT_CODE = 1;
const NOT_A_REPO_EXIT_CODE = 128;

export interface WorkspaceContentMatch {
  path: string;
  line: number;
  text: string;
}

export interface WorkspaceContentSearchResult {
  matches: WorkspaceContentMatch[];
  truncated: boolean;
}

async function isInsideWorkTree(cwd: string): Promise<boolean> {
  const { stdout } = await runGitCommand(["rev-parse", "--is-inside-work-tree"], {
    cwd,
    acceptExitCodes: [0, NOT_A_REPO_EXIT_CODE],
  });
  return stdout.trim() === "true";
}

/** With `-z` a record is `path\0line\0text`; the text can hold anything but a newline. */
function parseMatch(record: string): WorkspaceContentMatch | null {
  const pathEnd = record.indexOf("\0");
  const lineEnd = record.indexOf("\0", pathEnd + 1);
  if (pathEnd <= 0 || lineEnd < 0) return null;
  return {
    path: record.slice(0, pathEnd),
    line: Number(record.slice(pathEnd + 1, lineEnd)),
    text: record
      .slice(lineEnd + 1)
      .trim()
      .slice(0, MAX_LINE_LENGTH),
  };
}

/** Finds `query` as literal text. A query with no capitals ignores case, as in most editors. */
export async function searchWorkspaceContent(input: {
  cwd: string;
  query: string;
  limit?: number;
}): Promise<WorkspaceContentSearchResult> {
  const { cwd, query, limit = DEFAULT_LIMIT } = input;
  if (!query.trim()) return { matches: [], truncated: false };

  const source = (await isInsideWorkTree(cwd))
    ? ["--untracked", "--exclude-standard"]
    : ["--no-index", "--exclude-standard"];
  const ignoreCase = query === query.toLowerCase() ? ["-i"] : [];
  // `grep.fullName` would make paths relative to the repo root instead of the workspace.
  const args = ["-c", "grep.fullName=false", "grep", "-n", "-z", "-I", "--no-color", "-F"];
  const { stdout, truncated: outputCut } = await runGitCommand(
    [...args, ...ignoreCase, ...source, "-e", query, "--"],
    {
      cwd,
      timeout: TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      acceptExitCodes: [0, NO_MATCHES_EXIT_CODE],
    },
  ).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes("timed out")) {
      throw new Error("The search took too long. Try a longer query.");
    }
    throw error;
  });

  const records = stdout.split("\n");
  records.pop(); // After the final newline, or a record the output limit cut in half.
  const matches = records.flatMap((record) => parseMatch(record) ?? []);
  return {
    matches: matches.slice(0, limit),
    truncated: outputCut || matches.length > limit,
  };
}
