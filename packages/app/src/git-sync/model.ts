// CUSTOM(git-sync): the data and text behind the composer's git chips: "Trazer do <worktree>"
// on a main checkout, and "Resolver conflitos" wherever a checkout has unresolved conflicts.
// The status comes from the shell-command plugin's `git-sync` RPC.
import { z } from "zod";

export const GIT_SYNC_RPC = "git-sync";
export const SYNC_REPORT_RPC = "sync-report";

const gitConflictsSchema = z.object({
  dir: z.string(),
  operation: z.enum(["merge", "rebase", "cherry-pick", "revert"]).nullable(),
  currentBranch: z.string().nullable(),
  incoming: z.string().nullable(),
  files: z.array(z.string()),
});

const incomingWorktreeSchema = z.object({
  path: z.string(),
  branch: z.string(),
  ahead: z.number(),
  dirty: z.boolean(),
});

export const gitSyncStatusSchema = z.object({
  linkedWorktree: z.boolean(),
  conflicts: gitConflictsSchema.nullable(),
  mainConflicts: gitConflictsSchema.nullable(),
  incoming: z.array(incomingWorktreeSchema),
});

export type GitConflicts = z.output<typeof gitConflictsSchema>;
export type IncomingWorktree = z.output<typeof incomingWorktreeSchema>;
export type GitSyncStatus = z.output<typeof gitSyncStatusSchema>;

/** The chips the composer row shows at its end, after every other pill. */
export type TrailingGitChips =
  | { kind: "none" }
  | { kind: "resolve"; conflicts: GitConflicts }
  | { kind: "bring"; incoming: IncomingWorktree[] };

/**
 * A linked worktree's conflicts turn its Worktree chip into "Resolver conflitos" in place, so the
 * end of the row only carries them for other checkouts. Conflicts win over bringing more in.
 */
export function resolveTrailingGitChips(status: GitSyncStatus | null): TrailingGitChips {
  if (!status) return { kind: "none" };
  if (status.conflicts && !status.linkedWorktree) {
    return { kind: "resolve", conflicts: status.conflicts };
  }
  if (!status.linkedWorktree && !status.conflicts && status.incoming.length > 0) {
    return { kind: "bring", incoming: status.incoming };
  }
  return { kind: "none" };
}

/** The conflicts that turn a linked worktree's Worktree chip into "Resolver conflitos". */
export function resolveWorktreeChipConflicts(status: GitSyncStatus | null): GitConflicts | null {
  if (!status?.linkedWorktree) return null;
  return status.conflicts ?? status.mainConflicts;
}

export function worktreeName(worktreePath: string): string {
  const parts = worktreePath.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || worktreePath;
}

export function bringLabel(incoming: IncomingWorktree): string {
  return `Trazer do ${worktreeName(incoming.path)}`;
}

export function describeIncoming(incoming: IncomingWorktree): string {
  const parts: string[] = [];
  if (incoming.ahead > 0) {
    parts.push(incoming.ahead === 1 ? "1 commit" : `${incoming.ahead} commits`);
  }
  if (incoming.dirty) parts.push("mudanças não commitadas");
  return parts.join(" + ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Run in the main checkout: commits the worktree's uncommitted work as "wip" (as the Worktree
 * chip's Merge does), then merges the worktree's branch into the branch checked out here.
 */
export function buildBringWorktreeCommand(incoming: IncomingWorktree): string {
  const wt = shellQuote(incoming.path);
  const branch = shellQuote(incoming.branch);
  return [
    `git -C ${wt} add -A`,
    `{ git -C ${wt} diff --cached --quiet || git -C ${wt} commit -m 'wip'; }`,
    `echo "Trazendo ${incoming.branch.replace(/["$`\\]/g, "")} para $(git rev-parse --abbrev-ref HEAD)"`,
    `git merge --no-edit ${branch}`,
  ].join(" && ");
}

function describeOperation(conflicts: GitConflicts): string {
  const into = conflicts.currentBranch ? ` em \`${conflicts.currentBranch}\`` : "";
  const from = conflicts.incoming ? ` \`${conflicts.incoming}\`` : "";
  switch (conflicts.operation) {
    case "merge":
      return `um merge de${from || " outra branch"}${into}`;
    case "rebase":
      return `um rebase${conflicts.currentBranch ? ` de \`${conflicts.currentBranch}\`` : ""}${from ? ` sobre${from}` : ""}`;
    case "cherry-pick":
      return `um cherry-pick de${from || " um commit"}${into}`;
    case "revert":
      return `um revert de${from || " um commit"}${into}`;
    default:
      return `uma operação do git (por exemplo, um \`git stash pop\`)${into}`;
  }
}

function describeFinish(conflicts: GitConflicts): string {
  switch (conflicts.operation) {
    case "merge":
      return "conclua o merge com `git commit --no-edit`";
    case "rebase":
      return "continue com `git rebase --continue` (e resolva as próximas paradas do mesmo jeito)";
    case "cherry-pick":
      return "continue com `git cherry-pick --continue`";
    case "revert":
      return "continue com `git revert --continue`";
    default:
      return "deixe os arquivos resolvidos marcados com `git add`, sem commitar";
  }
}

function describeSides(conflicts: GitConflicts): string {
  switch (conflicts.operation) {
    case "merge":
      return "`git log --oneline --left-right HEAD...MERGE_HEAD -- <arquivo>`";
    case "rebase":
      return "`git log --oneline -3 REBASE_HEAD -- <arquivo>` e `git log --oneline -3 HEAD -- <arquivo>`";
    case "cherry-pick":
      return "`git show CHERRY_PICK_HEAD -- <arquivo>`";
    case "revert":
      return "`git show REVERT_HEAD -- <arquivo>`";
    default:
      return "`git diff <arquivo>`";
  }
}

/** The message the resolve tab's draft starts with; the user reviews it before sending. */
export function buildResolveConflictsPrompt(conflicts: GitConflicts): string {
  const files = conflicts.files.map((file) => `- \`${file}\``).join("\n");
  return [
    `Resolva os conflitos de ${describeOperation(conflicts)} no checkout \`${conflicts.dir}\`.`,
    "",
    `Arquivos em conflito (${conflicts.files.length}):`,
    files,
    "",
    "Como fazer:",
    `1. Trabalhe em \`${conflicts.dir}\`. Para cada arquivo, entenda o que cada lado quis fazer antes de editar: veja os commits dos dois lados com ${describeSides(conflicts)} e o trecho em conflito com \`git diff\`.`,
    "2. Combine as duas intenções em vez de escolher um lado inteiro; descarte uma mudança só quando a outra já a substitui, e diga por quê.",
    "3. Tire todos os marcadores (`<<<<<<<`, `=======`, `>>>>>>>`), confira com `git diff --check` e rode o build ou os testes que cobrem esses arquivos.",
    "4. Marque cada arquivo resolvido com `git add`.",
    "5. Se algum conflito pedir uma decisão que o código e o histórico não respondem, pare e me pergunte antes de seguir.",
    "6. Não use `--abort`, `git reset` nem `git checkout --ours/--theirs` em arquivo inteiro sem me perguntar.",
    `7. Com tudo resolvido, ${describeFinish(conflicts)} e me mostre um resumo do que ficou em cada arquivo.`,
  ].join("\n");
}
