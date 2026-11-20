// CUSTOM(projects-assistant): the Project Manager chat. A real Paseo agent, started in an empty
// folder and labeled `pwb/assistant-chat`, that manages the board through the tools below. The
// tools are attached in `agent.session_open` (see index.server.ts) on every create and resume.
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  defaultGroup,
  orderedGroups,
  type Card,
  type Group,
} from "../../shared/model";
import {
  ASSISTANT_ACTIONS,
  ASSISTANT_DEFAULT_ACTIONS,
  DEFAULT_REVIEW_POLICY,
  REVIEW_POLICIES,
  assistantSettingsSchema,
  projectPolicySchema,
  reviewPolicyFor,
  type AssistantActionInput,
  type ProjectPolicy,
  type HistoryEvent,
  type TaskProgress, // CUSTOM(task-checkpoints)
} from "../../shared/assistant";
import type { HistoryQuery } from "./history";
import { buildOverview, readConversation } from "./views";
import {
  DEFAULT_DIFF_BYTES,
  MAX_DIFF_BYTES,
  describeGitState,
  taskDiff,
  taskGitState,
} from "./task-git";
import type { Workboard } from "../workboard";
// CUSTOM(assistant-quick)
import { ACK_MESSAGE_MAX, normalizeAckStatus } from "../../shared/quick";
import type { QuickInbox } from "./quick";
// CUSTOM(assistant-reports)
import { reportEntryInputSchema } from "../../shared/assistant-reports";
import type { Data, Orchestration } from "../../shared/model";
import { resolveTaskReference } from "../../shared/task-reference"; // CUSTOM(task-numbers)
import { orchestratorPart, type ReportStore } from "./reports";
// CUSTOM(assistant-reply-protocol)
import {
  DONE_VERBS,
  NEXT_VALUES,
  REPLY_FENCE,
  REPLY_PROTOCOL_VERSION,
} from "../../shared/reply-protocol";
// CUSTOM(pm-board)
import {
  buildPmOverview,
  pmCardKindSchema,
  pmCardOptionSchema,
  pmCardStatusSchema,
} from "../../shared/pm-board";

export const CHAT_LABEL = "pwb/assistant-chat";

// CUSTOM(agent-profiles): the role text is the seed of the Project Manager profile's system-prompt.md;
// from then on that file is the source of truth and the chat's first message is only CHAT_INSTRUCTIONS.
const BOARD_TOOLS =
  "board_overview, board_list_tasks, board_get_task, board_task_diff, board_create_task, board_update_task, board_move_task, board_task_action, board_run_orchestrator, board_set_project_policy, board_set_default_action, board_history, board_read_agent, board_ack, board_report, board_reload_plugin, pm_card_create, pm_card_update, pm_card_decide, pm_card_archive";

// CUSTOM(task-numbers): the same reference is accepted everywhere a tool takes a task.
const TASK_ID_HINT = "Task UUID, or its short number as 42 or #42";

// CUSTOM(assistant-reply-protocol): the block every reply ends with. The doc path is the main
// checkout's, since the Project Manager runs in an empty folder; the words come from the parser.
export const REPLY_PROTOCOL_DOC =
  "/home/bruno/projetos/paseo/custom/plugins/power-workboard/docs/assistant-reply-protocol.md";
export const REPLY_PROTOCOL_RULE = [
  `End every reply to the user with a \`\`\`${REPLY_FENCE} block, protocol v${REPLY_PROTOCOL_VERSION} in ${REPLY_PROTOCOL_DOC}. One \`key: value\` per line, no braces, in this order:`,
  `- \`feito: <verb> <short task title> [<first 8 characters of the task id>]\`, one line per thing done; the verb is one of ${DONE_VERBS.join(", ")}.`,
  // CUSTOM(assistant-cards): the review map and structured questions (protocol v2).
  "- After a review, `pedido: <visto | testado | sem prova> | <what the user asked, quoted> | <proof: the command and what it showed, or the test's name>`, one line per thing asked, and `fora: <changed without being asked>` for anything outside the ask.",
  "- `aviso: <short>` and `bloqueio: <short>`, only when there is one.",
  "- When the user must decide: `pergunta: <question>`, then `opção: <id> | <label> | ganha: <what it gains> | custa: <what it costs>` per option and `recomendo: <id> | <why>`. Never ask an empty question: lay out the options and recommend one. The user answers in one tap. The same question is a proposal card on your PM board (pm_card_create, kind proposal): put its id in `seu` so the user can also decide it there.",
  `- \`próximo: <${NEXT_VALUES.join(" | ")}>\`: sigo = you carry on, agente = back to the task's agent, revisão = a reviewer is on it, você = waiting for the user, espera = waiting on something outside, fim = delivered.`,
  "- `seu: nada`, or a short verb and its object (decidir, aprovar, testar, reiniciar <x>), always the last key line. For a decision on a PM board proposal, add its card id: `seu: decidir <x> [pm:<card id>]`; a bare `[<task id>]` still opens the task.",
  "Put the why, criteria checked, checks, decisions and links after a `---` line inside the block: the chat shows them collapsed. Outside the block write at most a one-line direct answer when the user asked something. Never list commands you ran, test output that passed or steps that changed nothing.",
].join("\n");

export const ASSISTANT_ROLE = [
  "You are the Project Manager: the user's manager for their Workboard tasks and orchestrators, in Tasks mode. You act for the user: they want decisions made and reported, not questions.",
  `Manage tasks through your board tools (${BOARD_TOOLS}): create, move, start, continue and deliver every task there. Never edit a project's code, commit or merge outside board_task_action.`,
  "Every board tool that takes a task accepts its UUID or its short number as `42` or `#42`; the cards, board_list_tasks and board_overview show that number as `#42`.",
  'Investigation, proposals and decisions with the user go on your own board (the Decisões tab), not on the task board; code tasks and code reviews stay on the task board. Use pm_card_create, pm_card_update, pm_card_decide and pm_card_archive for them. An investigation is something you are looking into; a proposal is a choice the user must make (lay out the options with their gains and costs, recommend one, and the card waits in "Esperando você"); a decision is a call you already made on your own (kind decision, decidedBy pm); a notice is information the user should track. A PM card never starts an agent. Do not create a card for every event: only what the user should track. When you need the user, create a proposal and put its id in the reply\'s `seu` line as `[pm:<card id>]`.',
  "To review and diagnose, read freely: git log, git diff and git show in a task's worktree or the project's checkout, read any file, and run the task's tests in its worktree.",
  "Do not create Paseo agents to do a task: tasks go through the board so the orchestrators run them. A read-only reviewer subagent that helps you review a diff is fine. The one exception is the ship agent below.",
  "New tasks go to the Backlog unless the user asks to start them now; then create them with start=true so they land in the Ready to start column and an orchestrator picks them up.",
  "Write each task description as a complete ticket: goal, context, acceptance criteria and what is out of scope. If the project or the goal is unclear, make the most reasonable choice, say it, and create the task; ask only when you cannot guess.",
  [
    "When a task lands in Ready to review, size the review to its risk. Each project's review policy (self or fresh-agent) is in board_overview and comes from the Project Manager's settings: follow it, and treat a big or risky change as fresh-agent even in a self project.",
    "- Low risk (a project whose review is self, and a small change that is easy to revert): review the diff against each acceptance criterion, yourself or with a read-only reviewer subagent. If it is good, use board_task_action merge-now with wait=true without asking, create follow-up tasks for the non-blocking points, then report what you did.",
    "- Critical (a project whose review is fresh-agent in board_overview, or a big or risky change in any project): create a review task with start=true so a fresh agent, not the author, reviews the diff against the acceptance criteria without changing code. Read its report, tell the user what merge-now or mark-done will do, and wait for their ok.",
    "- Has problems: board_task_action continue with your feedback.",
  ].join("\n"),
  "Every message that wakes you (a quick message, a [Board] wake, a message from the user) carries the current Needs you list. Handle it before you end the reply: review and merge-now, send feedback with continue, answer the agent, or dismiss what is not yours; leave for the user only the ok before a fresh-agent merge, real product decisions and anything risky or hard to undo.",
  "Act for the user. When a board task's agent waits for the user's ok or a decision (a needs_input or blocked report, a question in its reply, the open decisions of a proposal), answer it yourself with board_task_action continue when you can do it with reasonable precision and no real risk. Agents outside the board may refuse an ok that comes from you; then leave that one for the user and don't insist. End with the list of decisions you took.",
  'Fix small blockers yourself. When a delivery is blocked by something small and reversible outside a project\'s code (your settings, through board_set_project_policy or board_set_default_action; daemon metadata such as a worktree\'s stored base; a stale lock), fix it, keep a backup in /home/bruno/uprojects/tmp when you change a file, and report it. Merge conflicts are retried by the board on its own; step in only when it gives up. A dirty base checkout may be another agent\'s live work, so check it before touching anything: when a task in `merging` shows "Waiting for a clean checkout" (in board_get_task or in Needs you), call list_agents and look for any agent, of any origin, whose cwd is that checkout and that is running or touched it recently. If one is there, do not stash and do not touch the checkout: let the board keep retrying the merge; if it gives up, tell the user which agent is in the checkout and which tasks are waiting on it. If no agent is working there, do not ask: save a backup of `git diff` and of the untracked files in /home/bruno/uprojects/tmp/<project>-dirty-backup-<YYYY-MM-DD>/, run `git stash push -u -m "assistant: <origin>, reaplicar após merges"` in that checkout, run the tests of each approved task that was waiting on the checkout, then run merge-now with wait=true on them, one at a time, and check with git log that their commits are on the base branch and their cards reached Done. Finish with `git stash pop` right after and tell the user what merged, where the backup is and that the edits are back. Escalate only if the stash pop conflicts: leave the stash intact and say which stash it is. Never discard those edits: no `checkout --`, no `reset --hard`, no `stash drop` without a pop. Ask before anything destructive or hard to undo, except for these steps.',
  'Ship what you merge in the paseo project. After merging changes under custom/plugins/power-workboard, call board_reload_plugin as the last action of your turn: it reloads the plugin when the turn ends, so your board tools keep working until then. Never run `plugin reload` yourself while you still need the board tools in this turn: a direct reload retires them and they only come back on the next message. When a merged change touches packages/ (the app or the daemon) and no paseo task is still in review or delivering, create one Paseo agent in /home/bruno/projetos/paseo whose only job is to ship: load the paseo-customizations skill, build and install, reopen the clients, and never restart a daemon. Create it with create_agent and labels {"paseo.board-agent": "true"}: that label keeps it out of the user\'s sidebar and notifications, and you report on it instead. Pass the same label to every Paseo agent you create. If the change needs a daemon restart, tell the user once, with the command kill-paseos-and-daemons.sh.',
  // CUSTOM(assistant-reports)
  "Report each action on a task once, with board_report: one entry per action (created, started, reviewed, sent feedback, answered an agent, fixed a blocker, merged, escalated to the user), with a one-sentence summary, a short markdown detail, the decisions you took and, when you talked to the task's agent, orchestrator {agentId, prompt: what you asked, reply: its answer, or leave reply out to store its last reply}. For a quick message, pass its id as quickMessageId: the summary becomes the status row's text. Then reply with the block below instead of writing the summary again.",
  "Announce merge-now or mark-done beforehand only for critical tasks; for low-risk ones act first, then report.",
  "After merge-now, confirm the commit is on the project's base branch (git log), not only that the card moved to Done.",
  "When the next step is the default one (a new task to the Backlog, an obvious follow-up), do it and say so instead of ending with a question. Ask only when the decision is the user's.",
  "Answer in the user's language, briefly.",
  REPLY_PROTOCOL_RULE, // CUSTOM(assistant-reply-protocol)
].join("\n\n");

/** Added to the seed: what Write, Edit and Bash may change. */
export const ASSISTANT_MEMORY_NOTE =
  "Write and Edit are only for your memory folder. Bash is for reading, running a task's tests, your memory folder, the plugin reload above and the small reversible fixes above; never use it to edit a project's code, commit or merge.";

export const ASSISTANT_SEED_PROMPT = `${ASSISTANT_ROLE}\n\n${ASSISTANT_MEMORY_NOTE}`;

// CUSTOM(assistant-compact): the rules alone open a chat started by compaction, which must not greet.
export const CHAT_RULES =
  'Your board tools are board_overview, board_list_tasks, board_get_task, board_task_diff, board_create_task, board_update_task, board_move_task, board_task_action, board_run_orchestrator, board_set_project_policy, board_set_default_action, board_history, board_read_agent, board_ack, board_report, board_reload_plugin, pm_card_create, pm_card_update, pm_card_decide and pm_card_archive. A task reference is its UUID or its short number as 42 or #42. Messages that start with [Quick message <id> ...] come from outside this chat; call board_ack first, before any other tool. Every message that wakes you carries the current Needs you list; handle it before you end the reply. Use board_reload_plugin (never a direct `plugin reload`) when the plugin code changed: it reloads at the end of the turn. After each action on a task, record it once with board_report (pass the quick message id when there is one). Investigation, proposals and decisions with the user go on your own board with the pm_card_* tools, never on the task board; code tasks and code reviews stay on the task board. End every reply with the ```pwb block your system prompt describes. Every Paseo agent you create with create_agent gets labels {"paseo.board-agent": "true"}, which hides it from the user\'s sidebar and notifications.';
/** The chat's first message; the role itself is in the profile's system prompt. */
export const CHAT_INSTRUCTIONS = `Call board_overview, then reply in one line: that you're ready, plus what is in Needs you (or that nothing is waiting). ${CHAT_RULES}`;

/** `<PASEO_HOME>/plugin-data/power-workboard/assistant-chat`, next to the history folder. */
export function defaultChatDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  const home = raw.startsWith("~")
    ? path.join(os.homedir(), raw.slice(1))
    : raw;
  return path.join(
    path.resolve(home),
    "plugin-data",
    "power-workboard",
    "assistant-chat",
  );
}

// CUSTOM(task-checkpoints): a long task's checklist and checkpoint log for board_get_task.
function checkpointLines(
  run: Orchestration | undefined,
  progress: TaskProgress | undefined,
): string {
  if (!progress) return "";
  const waiting =
    run?.checkpoint && (run.status === "queued" || run.status === "waiting")
      ? `Waiting to resume${run.resumeAt ? ` at ${run.resumeAt}` : " on the next pass"}${run.waitingFor ? ` (for ${run.waitingFor})` : ""}${run.limited ? " (paused by the usage limit)" : ""}\n`
      : "";
  return [
    `Checkpoints: ${progress.checkpoints} (${progress.stalls} in a row without a new done item)`,
    `${waiting}Done:\n${progress.done.map((item) => `- [x] ${item}`).join("\n") || "- none"}`,
    `Next:\n${progress.next.map((item) => `- [ ] ${item}`).join("\n") || "- none"}`,
    `Checkpoint log:\n${progress.log.map((entry) => `- ${entry.at} #${entry.checkpoint}: ${entry.text}`).join("\n")}`,
  ].join("\n");
}

// The installed @getpaseo/plugin types predate agent tools, so the shape is declared here; it is
// what `defineAgentTool` returns (that helper only validates the name).
export interface ChatTool {
  name: string;
  title?: string;
  description: string;
  input: z.ZodType;
  execute(input: any, context?: unknown): Promise<ChatToolResult>;
}
export interface ChatToolResult {
  text?: string;
  isError?: boolean;
}

/** Attach the tools to the chat's own sessions only (and never to a history read). */
export function attachChatTools<R extends { purpose: string }>(
  request: R,
  tools: readonly ChatTool[],
): R | undefined {
  const { labels, tools: current } = request as unknown as {
    labels?: Record<string, string>;
    tools?: ChatTool[];
  };
  if (labels?.[CHAT_LABEL] !== "true" || request.purpose === "history")
    return undefined;
  return { ...request, tools: [...(current ?? []), ...tools] };
}

export interface ChatHistory {
  list(
    query: HistoryQuery,
  ): Promise<{ events: HistoryEvent[]; nextCursor: string | null }>;
}

// Claude Code hands the model only `structuredContent` when it is present, so the tools return
// plain text and never structured content.
const text = (value: string): ChatToolResult => ({ text: value });

function define<Input extends z.ZodType>(tool: {
  name: string;
  description: string;
  input: Input;
  execute(input: z.output<Input>): Promise<ChatToolResult>;
}): ChatTool {
  return {
    ...tool,
    execute: async (input) => {
      try {
        return await tool.execute(tool.input.parse(input));
      } catch (error) {
        const reason =
          error instanceof z.ZodError
            ? error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")
            : error instanceof Error
              ? error.message
              : String(error);
        return { text: `Error: ${reason}`, isError: true };
      }
    },
  };
}

/** CUSTOM(assistant-quick): the assistant's short ack of a quick message. */
export function quickAckTool(inbox: Pick<QuickInbox, "ack">): ChatTool {
  return define({
    name: "board_ack",
    description:
      'Call this FIRST, before any other tool, when a user message starts with "[Quick message <id> ...]". status "ok" = understood and you will do it (message: one short sentence of what you will do, in the user\'s language); "needs-input" = you need something from the user first (message: the question); "error" = you cannot do it (message: why). You may call it again later with the same id to update the state.',
    input: z.object({
      id: z.string().optional(),
      status: z.string(),
      message: z
        .string()
        .min(1)
        .max(ACK_MESSAGE_MAX * 2),
    }),
    async execute({ id, status, message }) {
      const normalized = normalizeAckStatus(status);
      if (!normalized)
        throw new Error(
          `Unknown status "${status}". Use ok, needs-input or error.`,
        );
      const entry = inbox.ack(id, normalized, message);
      return text(`Acknowledged ${entry.id}: ${normalized}.`);
    },
  });
}

/** An agent the board started for a task (not the chat, not the user's other agents). */
export function isManagedAgent(data: Data, agentId: string): boolean {
  return (
    Object.values(data.orchestrations).some((o) => o.agentId === agentId) ||
    Object.values(data.assistant.attempts).some((list) =>
      list.some((a) => a.agentId === agentId),
    )
  );
}

/**
 * CUSTOM(assistant-reports): the assistant's one record per action on a task. It feeds the
 * Projects Reports page and, with `quickMessageId`, the quick message's ack in the status row.
 */
export function boardReportTool(
  getBoard: () => Pick<
    Workboard,
    "assistantSource" | "snapshot" | "chatLastReply" | "noteAssistantReported"
  >,
  reports: Pick<ReportStore, "append">,
  inbox: Pick<QuickInbox, "ack" | "list">,
): ChatTool {
  return define({
    name: "board_report",
    description:
      "Record one action you took on a task, once, for the Projects Reports page. taskId accepts the UUID or the short number (42 or #42). kind: created, started, moved, reviewed, feedback, answered, fixed, merged, escalated or note. summary: ONE sentence, in the user's language; it is also your short chat reply and, with quickMessageId, the status row's text (quickStatus ok, needs-input or error; default: the message's current state, ok while pending). detail: short markdown (what you checked, what changed). decisions: the decisions you took, one per item. orchestrator: when you talked to the task's agent, {agentId, prompt: what you asked it, reply: its answer}; leave reply out to store the agent's last reply (its <report> block is read from it). The server fills the project and the time.",
    input: reportEntryInputSchema,
    async execute(input) {
      const board = getBoard();
      const data = board.assistantSource().data;
      // CUSTOM(task-numbers): the tool accepts `42` or `#42` as well as the UUID.
      const task = resolveTaskReference(data.tasks, input.taskId);
      if (!task)
        throw new Error(
          `No task with id ${input.taskId}. Use board_list_tasks to find its id or number.`,
        );
      const snapshot = board.snapshot();
      const card = snapshot.cards.find((c) => c.id === task.id);
      const projectId = card?.projectId ?? task.projectId ?? null;
      let orchestrator = null;
      if (input.orchestrator) {
        const { agentId, prompt } = input.orchestrator;
        const reply =
          input.orchestrator.reply ??
          (isManagedAgent(data, agentId)
            ? await board.chatLastReply(agentId).catch(() => null)
            : null);
        orchestrator = orchestratorPart({ agentId, prompt, reply });
      }
      const stored = await reports.append({
        taskId: task.id,
        taskTitle: task.title,
        projectId,
        projectName:
          card?.projectName ||
          task.projectName ||
          snapshot.projects.find((p) => p.id === projectId)?.name ||
          "",
        kind: input.kind,
        summary: input.summary,
        detail: input.detail || null,
        decisions: input.decisions ?? [],
        orchestrator,
        quickMessageId: input.quickMessageId ?? null,
      });
      // CUSTOM(assistant-wake): a recorded action counts as handling the task for the reminder.
      await board.noteAssistantReported(task.id);
      const lines = [`Recorded ${stored.kind} for "${task.title}".`];
      if (input.quickMessageId) {
        const quick = inbox.list().find((q) => q.id === input.quickMessageId);
        if (!quick)
          lines.push(
            `Quick message ${input.quickMessageId} is gone (they live in memory), so the status row was not updated.`,
          );
        else {
          const status =
            input.quickStatus ??
            (quick.status === "pending" ? "ok" : quick.status);
          inbox.ack(quick.id, status, stored.summary);
          lines.push(`Status row for ${quick.id}: ${status}.`);
        }
      }
      lines.push(`Reply with this summary: ${stored.summary}`);
      return text(lines.join("\n"));
    },
  });
}

/** How long board_task_action with wait=true waits for a delivery, and how often it looks. */
const WAIT_LIMIT_MS = 120_000;
const WAIT_POLL_MS = 200;

const groupName = (group: Group) => group.name ?? group.label;

export function chatTools(
  getBoard: () => Workboard,
  history: ChatHistory,
): ChatTool[] {
  const board = () => getBoard();
  /** A group by id, or the first group of a kind (`todo`, `ready`, `review`, `done`...). */
  const resolveGroup = (reference: string): Group => {
    const settings = board().snapshot().settings;
    const groups = orderedGroups(settings);
    const found =
      groups.find((g) => g.id === reference) ??
      groups.find((g) => g.kind === reference) ??
      groups.find(
        (g) => groupName(g).toLowerCase() === reference.toLowerCase(),
      );
    if (!found)
      throw new Error(
        `No column "${reference}". Columns: ${groups.map((g) => `${g.id} (${g.kind})`).join(", ")}`,
      );
    return found;
  };
  const choices = (items: { id: string; name: string }[]) =>
    items.map((i) => `${i.id} (${i.name})`).join(", ") || "none";
  /** A project by id, name or directory basename; throws listing the valid choices. */
  const resolveProject = (reference: string): string => {
    const projects = board().snapshot().projects;
    const wanted = reference.trim().toLowerCase();
    const byId = projects.find((p) => p.id === reference);
    if (byId) return byId.id;
    const pick = (matches: typeof projects, how: string) => {
      if (matches.length === 1) return matches[0].id;
      if (matches.length > 1)
        throw new Error(
          `Project "${reference}" is ambiguous (${how}). Use one of: ${choices(matches)}`,
        );
      return null;
    };
    const resolved =
      pick(
        projects.filter((p) => p.name.toLowerCase() === wanted),
        "name",
      ) ??
      pick(
        projects.filter(
          (p) => path.basename(p.directory).toLowerCase() === wanted,
        ),
        "directory",
      );
    if (resolved) return resolved;
    throw new Error(
      `No project "${reference}". Projects: ${choices(projects)}`,
    );
  };
  /** An orchestrator by id or name; throws listing the valid choices. */
  const resolveOrchestrator = (reference: string): string => {
    const orchestrators = board().snapshot().orchestrators;
    const byId = orchestrators.find((o) => o.id === reference);
    if (byId) return byId.id;
    const matches = orchestrators.filter(
      (o) => o.name.toLowerCase() === reference.trim().toLowerCase(),
    );
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1)
      throw new Error(
        `Orchestrator "${reference}" is ambiguous. Use one of: ${choices(matches)}`,
      );
    throw new Error(
      `No orchestrator "${reference}". Orchestrators: ${choices(orchestrators)}`,
    );
  };
  // CUSTOM(task-numbers): every tool resolves a UUID, `42` or `#42`.
  const card = (taskId: string): Card => {
    const found = resolveTaskReference(board().snapshot().cards, taskId);
    if (!found)
      throw new Error(
        `No task with id ${taskId}. Use board_list_tasks to find its id or number.`,
      );
    return found;
  };
  const delivery = (taskId: string) =>
    board().assistantSource().data.assistant.deliveries[taskId];
  const columnOf = (c: Card) => {
    const group = board()
      .snapshot()
      .settings.groups.find((g) => g.id === c.stage);
    return group ? groupName(group) : c.stage;
  };
  const orchestratorName = (id: string | null) =>
    id
      ? (board()
          .snapshot()
          .orchestrators.find((o) => o.id === id)?.name ?? id)
      : "-";
  const line = (c: Card) =>
    `${c.number > 0 ? `#${c.number} | ` : ""}${c.id} | ${c.title} | project: ${c.projectName || c.projectId || "-"} | column: ${columnOf(c)} (${c.stage}) | orchestrator: ${orchestratorName(c.orchestratorId)} | delivery: ${delivery(c.id)?.stage ?? "-"} | updated: ${c.updatedAt}`;
  const managedAgent = (agentId: string) =>
    isManagedAgent(board().assistantSource().data, agentId);

  const checkout = (taskId: string) => {
    const c = card(taskId);
    return board().assistantTaskCheckout(c.id);
  };
  const NO_WORKTREE =
    "Worktree: none. This task has no workspace yet (or it was archived), so there is nothing to diff.";
  const worktreeSection = async (taskId: string) => {
    const found = checkout(taskId);
    if (!found) return NO_WORKTREE;
    try {
      return describeGitState(await taskGitState(found));
    } catch (error) {
      return `Worktree: ${found.directory}\nGit: unavailable (${error instanceof Error ? error.message : String(error)})`;
    }
  };

  /** Wait until a delivery leaves verifying, committing and merging, then say where it ended. */
  const waitForDelivery = async (taskId: string): Promise<string> => {
    const running = new Set(["verifying", "committing", "merging"]);
    const deadline = Date.now() + WAIT_LIMIT_MS;
    while (running.has(delivery(taskId)?.stage ?? "") && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
    const d = delivery(taskId);
    if (!d) return `No delivery for ${taskId}.`;
    const tail = `${d.reason ? `, reason ${d.reason}` : ""}${d.detail ? ` (${d.detail})` : ""}`;
    if (running.has(d.stage))
      return `Still ${d.stage} after ${WAIT_LIMIT_MS / 1000} s${tail}. Check board_get_task later.`;
    return `merge-now for ${taskId} ended at stage ${d.stage}${tail}.`;
  };

  return [
    define({
      name: "board_overview",
      description:
        "Overview of the Workboard: projects, orchestrators, columns with task counts, the tasks that need the user, and the Project Manager settings.",
      input: z.object({}),
      async execute() {
        const snapshot = board().snapshot();
        const source = board().assistantSource();
        const groups = orderedGroups(snapshot.settings);
        const needsYou = (() => {
          try {
            return buildOverview(source).needsYou;
          } catch {
            return [];
          }
        })();
        const settings = source.data.assistant.settings;
        // CUSTOM(assistant-review-policy): each project's review policy, and the ones set apart.
        const reviewed = Object.entries(settings.reviews)
          .filter(([, review]) => review !== DEFAULT_REVIEW_POLICY)
          .map(([id, review]) => {
            const name = snapshot.projects.find((p) => p.id === id)?.name;
            return `${name ? `${name} (${id})` : id}=${review}`;
          });
        const pm = buildPmOverview(source.data.assistant?.pmBoard); // CUSTOM(pm-board)
        const taskNumbers = new Map(
          source.data.tasks.map((task) => [task.id, task.number]),
        ); // CUSTOM(task-numbers)
        const lines = [
          `Projects:\n${snapshot.projects.map((p) => `- ${p.id} | ${p.name} | ${p.isGit ? "git" : "not git"} | ${p.directory} | review: ${reviewPolicyFor(settings, p.id)}`).join("\n") || "- none"}`,
          `Orchestrators:\n${
            snapshot.orchestrators
              .map((o) => {
                const status = snapshot.orchestratorStatus[o.id];
                return `- ${o.id} | ${o.name} | project: ${o.projectId ?? "any"} | ${o.enabled ? "enabled" : "disabled"}${status?.active ? ", active" : ""} | running ${status?.running ?? 0}, waiting ${status?.waiting ?? 0}`;
              })
              .join("\n") || "- none"
          }`,
          `Columns:\n${groups
            .map(
              (g) =>
                `- ${g.id} | ${groupName(g)} | ${g.kind} | ${snapshot.cards.filter((c) => !c.archived && c.stage === g.id).length} tasks`,
            )
            .join("\n")}`,
          `Needs you:\n${needsYou.map((n) => `- ${taskNumbers.get(n.taskId) ? `#${taskNumbers.get(n.taskId)} | ` : ""}${n.taskId} | ${n.title} | project: ${n.projectName || n.projectId || "-"} | orchestrator: ${n.orchestratorName ?? "-"} | agent: ${n.agentId ?? "-"} | attempt: ${n.attempt ?? "-"} | since: ${n.since} | can merge: ${n.canMerge ? "yes" : "no"} | ${n.reason}${n.detail ? `: ${n.detail}` : ""}`).join("\n") || "- nothing"}`,
          // CUSTOM(pm-board): your own board, apart from the task board.
          `Project Manager board (investigations, proposals and decisions; code tasks and code reviews stay on the task board):\ninvestigating ${pm.investigating}, waiting for the user ${pm.waiting}, decided ${pm.decided}, archived ${pm.archived}\n${pm.cards.map((c) => `- ${c.id} | ${c.kind} | ${c.title} | since: ${c.since}`).join("\n") || "- nothing waiting"}`,
          `Project Manager: ${settings.enabled ? "on" : "off"}, default action ${settings.defaultAction}; per project: ${
            Object.entries(settings.projects)
              .map(
                ([id, p]) =>
                  `${id}=${p.action}${p.observe ? " (observe)" : ""}`,
              )
              .join(", ") || "none"
          }; review per project: ${reviewed.join(", ") || "none"}, the rest ${DEFAULT_REVIEW_POLICY}`,
        ];
        return text(lines.join("\n\n"));
      },
    }),
    define({
      name: "board_list_tasks",
      description:
        "List tasks, newest update first. Filter by column (group id or kind), project (id or name) or a text query.",
      input: z.object({
        column: z
          .string()
          .optional()
          .describe("A column's group id or kind, such as todo or ready"),
        projectId: z.string().optional().describe("A project's id or name"),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(30),
      }),
      async execute(input) {
        const stage = input.column ? resolveGroup(input.column).id : null;
        const project = input.projectId
          ? resolveProject(input.projectId)
          : null;
        const query = input.query?.toLowerCase();
        const cards = board()
          .snapshot()
          .cards.filter(
            (c) =>
              !c.archived &&
              (!stage || c.stage === stage) &&
              (!project || c.projectId === project) &&
              (!query ||
                `${c.title}\n${c.description}`.toLowerCase().includes(query)),
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, input.limit);
        return text(cards.map(line).join("\n") || "No tasks.");
      },
    }),
    define({
      name: "board_get_task",
      description:
        "Everything about one task: description, column, attempts, delivery, last summary, PR text, and its worktree (path, branch, base branch, commits ahead and diffstat including new uncommitted files).",
      input: z.object({ taskId: z.string().describe(TASK_ID_HINT) }),
      async execute({ taskId }) {
        const c = card(taskId);
        const id = c.id;
        const data = board().assistantSource().data;
        const run = data.orchestrations[id];
        const d = data.assistant.deliveries[id];
        const finish = data.finishes[id];
        const attempts = data.assistant.attempts[id] ?? [];
        const parts = [
          line(c),
          `Description:\n${c.description || "(empty)"}`,
          `Run: ${run ? `${run.status}, agent ${run.agentId ?? "-"}${run.error ? `, error: ${run.error}` : ""}` : "none"}`,
          `Last summary: ${run?.summary ?? "-"}`,
          checkpointLines(run, data.assistant.progress[id]), // CUSTOM(task-checkpoints)
          `Attempts:\n${attempts.map((a) => `- #${a.index} ${a.trigger} | agent ${a.agentId ?? "-"} | ${a.outcome}${a.feedback ? ` | feedback: ${a.feedback}` : ""}`).join("\n") || "- none"}`,
          d
            ? `Delivery: ${d.stage}, action ${d.action}${d.reason ? `, reason ${d.reason}` : ""}${d.detail ? ` (${d.detail})` : ""}${d.report ? `\nReport: ${d.report.status}: ${d.report.summary}${d.report.risks.length ? `\nRisks: ${d.report.risks.join("; ")}` : ""}${d.report.question ? `\nQuestion: ${d.report.question}` : ""}` : ""}`
            : "Delivery: none",
          finish?.prTitle || finish?.prBody
            ? `Prepared PR: ${finish.prTitle ?? ""}\n${finish.prBody ?? ""}`
            : "",
          finish?.mergedAt ? `Merged at ${finish.mergedAt}` : "",
          await worktreeSection(id),
        ];
        return text(parts.filter(Boolean).join("\n\n"));
      },
    }),
    define({
      name: "board_task_diff",
      description: `Read only. The task's diff against its base branch (or, for a task that runs directly in the project folder, the HEAD it started at): its commits, uncommitted edits and new untracked files, after a header with the worktree, branch, base and diffstat. Output is cut at maxBytes (default ${DEFAULT_DIFF_BYTES}); when it is cut, call again with path set to one file or folder from the diffstat.`,
      input: z.object({
        taskId: z.string().describe(TASK_ID_HINT),
        path: z
          .string()
          .min(1)
          .optional()
          .describe("Only this file or folder, relative to the worktree root"),
        maxBytes: z
          .number()
          .int()
          .min(1000)
          .max(MAX_DIFF_BYTES)
          .default(DEFAULT_DIFF_BYTES),
      }),
      async execute(input) {
        const found = checkout(input.taskId);
        if (!found) return text(NO_WORKTREE);
        const result = await taskDiff(found, {
          path: input.path,
          maxBytes: input.maxBytes,
        });
        const header = describeGitState(result.state);
        const body = result.diff || "(no changes)";
        const notice = result.truncated
          ? `\n[Truncated: showed ${Buffer.byteLength(result.diff, "utf8")} of ${result.totalBytes ?? `more than ${input.maxBytes}`} bytes. Call board_task_diff again with path set to one file or folder from the diffstat${input.maxBytes < MAX_DIFF_BYTES ? `, or a larger maxBytes (up to ${MAX_DIFF_BYTES})` : ""}.]`
          : "";
        return text(
          `${header}${input.path ? `\nPath filter: ${input.path}` : ""}\n\nDiff:\n${body}${notice}`,
        );
      },
    }),
    define({
      name: "board_create_task",
      description:
        "Create a task. By default it goes to the Backlog; with start=true it goes to the Ready to start column, where an orchestrator picks it up. Write the description as a complete ticket.",
      input: z.object({
        title: z.string().min(1).max(1000),
        description: z.string().max(50000).default(""),
        projectId: z
          .string()
          .optional()
          .describe("A project's id or name, as listed by board_overview"),
        orchestratorId: z
          .string()
          .optional()
          .describe("An orchestrator's id or name"),
        start: z.boolean().default(false),
      }),
      async execute(input) {
        const snapshot = board().snapshot();
        const stage = input.start
          ? resolveGroup("ready").id
          : defaultGroup(
              snapshot.settings.groups,
              snapshot.settings.defaultDraftGroup,
            );
        const projectId = input.projectId
          ? resolveProject(input.projectId)
          : null;
        const orchestratorId = input.orchestratorId
          ? resolveOrchestrator(input.orchestratorId)
          : null;
        const before = new Set(snapshot.cards.map((c) => c.id));
        const after = await board().mutate(
          {
            action: "create",
            title: input.title,
            description: input.description,
            projectId,
            ...(orchestratorId ? { orchestratorId } : {}),
            stage,
          },
          "assistant",
        ); // CUSTOM(assistant-cards): the history's `by`
        const created = after.cards.find((c) => !before.has(c.id));
        if (!created) throw new Error("The task was not created");
        return text(
          `Created ${created.id}${created.number > 0 ? ` (#${created.number})` : ""} "${created.title}" in ${columnOf(created)} (${created.stage}), project: ${created.projectName || created.projectId || "-"}.`,
        );
      },
    }),
    define({
      name: "board_update_task",
      description:
        "Change a task's title, description, project (id or name) or orchestrator (id or name). Omitted fields stay as they are; null clears the project or orchestrator.",
      input: z.object({
        taskId: z.string().describe(TASK_ID_HINT),
        title: z.string().min(1).max(1000).optional(),
        description: z.string().max(50000).optional(),
        projectId: z.string().nullable().optional(),
        orchestratorId: z.string().nullable().optional(),
      }),
      async execute(input) {
        const c = card(input.taskId);
        const projectId =
          input.projectId === undefined || input.projectId === null
            ? input.projectId
            : resolveProject(input.projectId);
        const orchestratorId =
          input.orchestratorId === undefined || input.orchestratorId === null
            ? input.orchestratorId
            : resolveOrchestrator(input.orchestratorId);
        await board().mutate(
          {
            action: "edit",
            taskId: c.id,
            updatedAt: c.updatedAt,
            title: input.title ?? c.title,
            description: input.description ?? c.description,
            projectId: projectId !== undefined ? projectId : c.projectId,
            ...(orchestratorId !== undefined ? { orchestratorId } : {}),
          },
          "assistant",
        ); // CUSTOM(assistant-cards): the history's `by`
        return text(`Updated ${c.id}${c.number > 0 ? ` (#${c.number})` : ""}.`);
      },
    }),
    define({
      name: "board_move_task",
      description:
        "Move a task to a column (group id or kind), like dragging its card. The board refuses moves it does not allow, such as putting a task that has no workspace into In progress.",
      input: z.object({
        taskId: z.string().describe(TASK_ID_HINT),
        column: z.string(),
      }),
      async execute({ taskId, column }) {
        const c = card(taskId);
        const group = resolveGroup(column);
        await board().mutate(
          {
            action: "stage",
            taskId: c.id,
            stage: group.id,
            expectedLabels: c.managedLabels,
            expectedUpdatedAt: c.updatedAt,
            expectedGroup: {
              id: group.id,
              kind: group.kind,
              label: group.label,
            },
          },
          "assistant",
        ); // CUSTOM(assistant-cards): the history's `by`
        return text(
          `Moved ${c.id}${c.number > 0 ? ` (#${c.number})` : ""} to ${groupName(group)}.`,
        );
      },
    }),
    define({
      name: "board_task_action",
      description:
        "Act on a task that is in review or done: merge-now (commit and merge into the base branch), prepare-pr, continue (send it back to its agent with feedback), mark-done, or dismiss (take it off Needs you). With wait=true, merge-now waits (up to 120 s) for the delivery to finish and returns its final stage, reason and detail.",
      input: z.object({
        taskId: z.string().describe(TASK_ID_HINT),
        type: z.enum([
          "merge-now",
          "prepare-pr",
          "continue",
          "mark-done",
          "dismiss",
        ]),
        feedback: z.string().max(20000).optional(),
        wait: z
          .boolean()
          .default(false)
          .describe("With merge-now: wait for the delivery to finish"),
      }),
      async execute(input) {
        const c = card(input.taskId); // CUSTOM(task-numbers)
        const action: AssistantActionInput =
          input.type === "continue"
            ? {
                type: "continue",
                taskId: c.id,
                feedback: input.feedback ?? "",
              }
            : { type: input.type, taskId: c.id };
        await board().assistantAction(action, "assistant"); // CUSTOM(assistant-cards)
        if (input.type === "merge-now" && input.wait)
          return text(await waitForDelivery(c.id));
        return text(
          input.type === "merge-now" || input.type === "prepare-pr"
            ? `Started ${input.type} for ${c.id}; it runs in the background. Check board_get_task for the result.`
            : `Done: ${input.type} for ${c.id}.`,
        );
      },
    }),
    define({
      name: "board_set_project_policy",
      description:
        "Change a project's delivery policy (project by id or name). Only the fields you pass change; a project without its own policy starts from the default action. action: review, merge, prepare-pr, notify or nothing. review: self or fresh-agent (you cannot change fresh-agent to self; only the user does, in Settings). Returns the resulting policy.",
      input: z.object({
        project: z.string().describe("A project's id or name"),
        action: z.enum(ASSISTANT_ACTIONS).optional(),
        baseBranch: z.string().max(200).optional(),
        verifyCommand: z.string().max(2000).optional(),
        autoFixes: z.number().int().min(0).max(3).optional(),
        observe: z.boolean().optional(),
        review: z.enum(REVIEW_POLICIES).optional(),
      }),
      async execute(input) {
        const projectId = resolveProject(input.project);
        const settings = board().assistantSettings().settings;
        if (
          input.review === "self" &&
          reviewPolicyFor(settings, projectId) === "fresh-agent"
        )
          throw new Error(
            "This project's review is fresh-agent; only the user changes that, in Settings.",
          );
        const patch: Partial<ProjectPolicy> = {};
        if (input.action !== undefined) patch.action = input.action;
        if (input.baseBranch !== undefined) patch.baseBranch = input.baseBranch;
        if (input.verifyCommand !== undefined)
          patch.verifyCommand = input.verifyCommand;
        if (input.autoFixes !== undefined) patch.autoFixes = input.autoFixes;
        if (input.observe !== undefined) patch.observe = input.observe;
        const current =
          settings.projects[projectId] ??
          projectPolicySchema.parse({ action: settings.defaultAction });
        const changesPolicy = Object.keys(patch).length > 0;
        const policy = projectPolicySchema.parse({ ...current, ...patch });
        const reviews = { ...settings.reviews };
        if (input.review === "fresh-agent") reviews[projectId] = "fresh-agent";
        else if (input.review === "self") delete reviews[projectId];
        const saved = await board().setAssistantSettings(
          assistantSettingsSchema.parse({
            ...settings,
            // Setting only the review gives the project no policy of its own.
            projects:
              changesPolicy || settings.projects[projectId]
                ? { ...settings.projects, [projectId]: policy }
                : settings.projects,
            reviews,
          }),
        );
        const name =
          saved.projects.find((p) => p.id === projectId)?.name ?? projectId;
        return text(
          `${name} (${projectId}): action ${policy.action}${policy.observe ? " (observe)" : ""}, review ${reviewPolicyFor(saved.settings, projectId)}, base branch ${policy.baseBranch || "the project's current branch"}, check command ${policy.verifyCommand || "none"}, auto-fixes ${policy.autoFixes}.`,
        );
      },
    }),
    define({
      name: "board_set_default_action",
      description:
        "Change the delivery action of projects with no policy of their own: review, prepare-pr, notify or nothing (merge is never a default). Returns the new default.",
      input: z.object({ action: z.enum(ASSISTANT_DEFAULT_ACTIONS) }),
      async execute({ action }) {
        const settings = board().assistantSettings().settings;
        const saved = await board().setAssistantSettings(
          assistantSettingsSchema.parse({ ...settings, defaultAction: action }),
        );
        return text(`Default action: ${saved.settings.defaultAction}.`);
      },
    }),
    define({
      name: "board_run_orchestrator",
      description:
        "Run an orchestrator now (Run now): it takes one batch from Ready to start.",
      input: z.object({ orchestratorId: z.string() }),
      async execute({ orchestratorId }) {
        await board().mutate(
          {
            action: "orchestrator-run",
            id: orchestratorId,
          },
          "assistant",
        ); // CUSTOM(assistant-cards): the history's `by`
        return text(`Orchestrator ${orchestratorId} is running.`);
      },
    }),
    define({
      name: "board_reload_plugin",
      description:
        "Reload the Workboard plugin after its code or settings changed. The reload runs when this turn ends, so board tools keep working for the rest of the turn; the new code is live on the next turn. Use this instead of running `plugin reload` yourself: a direct reload retires the board tools until the next message.",
      input: z.object({}),
      async execute() {
        if (!board().requestPluginReload())
          return text(
            "No Project Manager chat is open, so there is no turn to wait for; reload the plugin yourself.",
          );
        return text(
          "The plugin will reload when this turn ends. Board tools keep working until then.",
        );
      },
    }),
    define({
      name: "board_history",
      description:
        "The Project Manager's history, newest first, one line per event.",
      input: z.object({
        limit: z.number().int().min(1).max(50).default(20),
        taskId: z.string().optional().describe(TASK_ID_HINT),
        projectId: z.string().optional().describe("A project's id or name"),
      }),
      async execute(input) {
        const projectId = input.projectId
          ? resolveProject(input.projectId)
          : null;
        // CUSTOM(task-numbers): resolve a short number, but keep an id of a removed task.
        const taskId = input.taskId
          ? (resolveTaskReference(board().snapshot().cards, input.taskId)?.id ??
            input.taskId)
          : null;
        const page = await history.list({
          cursor: null,
          limit: input.limit,
          projectId,
          orchestratorId: null,
          taskId,
          kinds: [],
          from: null,
          to: null,
        });
        return text(
          page.events
            .map(
              (e) =>
                `${e.at} | ${e.kind} | ${e.taskTitle} (${e.taskId}) | ${e.text}`,
            )
            .join("\n") || "No events.",
        );
      },
    }),
    define({
      name: "board_read_agent",
      description:
        "Read the last messages of an agent this board started for a task.",
      input: z.object({
        agentId: z.string(),
        limit: z.number().int().min(1).max(40).default(15),
      }),
      async execute({ agentId, limit }) {
        if (!managedAgent(agentId))
          throw new Error(
            "This agent is not managed by the board; only task agents can be read",
          );
        const conversation = await readConversation(
          board().assistantSource(),
          agentId,
          board().assistantTimeline(agentId),
          { before: null, limit: Math.max(limit * 4, 50) },
        );
        const messages = conversation.items
          .filter((item) => item.kind === "user" || item.kind === "assistant")
          .slice(-limit);
        return text(
          messages.map((item) => `[${item.kind}] ${item.text}`).join("\n\n") ||
            "No messages yet.",
        );
      },
    }),
    // CUSTOM(pm-board): the Project Manager's own board. Investigation, proposals and decisions
    // with the user live here; these tools never create a task, a workspace or an agent.
    define({
      name: "pm_card_create",
      description:
        'Create a card on your own Project Manager board (the Decisões tab), apart from the task board. kind: "investigation" (something you are looking into, starts in Investigating), "proposal" (a choice the user must make: put question, options with gains and costs, and recommend one; it waits in "Esperando você"), "decision" (a call you already made on your own; pass decision and it starts Decided with decidedBy pm) or "notice" (information the user should track). Never create a card for every event: only what the user should track. Code tasks and code reviews are not PM cards: they stay on the task board (board_create_task). taskIds/reportIds link the card to tasks and their Reports tickets.',
      input: z.object({
        kind: pmCardKindSchema,
        title: z.string().min(1).max(500),
        question: z.string().max(5000).nullable().default(null),
        options: z.array(pmCardOptionSchema).max(8).default([]),
        recommend: z.string().max(40).nullable().default(null),
        why: z.string().max(2000).nullable().default(null),
        findings: z.string().max(20000).default(""),
        decision: z.string().max(5000).nullable().default(null),
        taskIds: z.array(z.string()).max(50).default([]),
        reportIds: z.array(z.string()).max(50).default([]),
      }),
      async execute(input) {
        const card = await board().pmCardCreate({
          kind: input.kind,
          title: input.title,
          question: input.question,
          options: input.options,
          recommend: input.recommend,
          why: input.why,
          findings: input.findings,
          decision: input.decision,
          links: { taskIds: input.taskIds, reportIds: input.reportIds },
        });
        return text(
          `Created PM card ${card.id} (${card.kind}, ${card.status}): "${card.title}".`,
        );
      },
    }),
    define({
      name: "pm_card_update",
      description:
        'Update one of your PM cards: title, question, options, recommendation, findings, decision, answer, links or status. Use status "waiting" when an investigation now needs the user, and status "decided" with decision and decidedBy "pm" when you decide alone; the board records who decided and when. Closing a proposal or a decision needs a non-empty decision or answer. Replacing the options drops a recommendation that names none of them.',
      input: z.object({
        id: z.string(),
        title: z.string().min(1).max(500).optional(),
        question: z.string().max(5000).nullable().optional(),
        options: z.array(pmCardOptionSchema).max(8).optional(),
        recommend: z.string().max(40).nullable().optional(),
        why: z.string().max(2000).nullable().optional(),
        findings: z.string().max(20000).optional(),
        decision: z.string().max(5000).nullable().optional(),
        answer: z.string().max(5000).nullable().optional(),
        status: pmCardStatusSchema.optional(),
        decidedBy: z.enum(["pm", "user"]).optional(),
        taskIds: z.array(z.string()).max(50).optional(),
        reportIds: z.array(z.string()).max(50).optional(),
      }),
      async execute(input) {
        const current = board()
          .pmCards()
          .find((card) => card.id === input.id);
        if (!current) throw new Error(`No PM card with id ${input.id}.`);
        const links =
          input.taskIds || input.reportIds
            ? {
                taskIds: input.taskIds ?? current.links.taskIds,
                reportIds: input.reportIds ?? current.links.reportIds,
              }
            : undefined;
        const card = await board().pmCardUpdate(input.id, {
          title: input.title,
          question: input.question,
          options: input.options,
          recommend: input.recommend,
          why: input.why,
          findings: input.findings,
          decision: input.decision,
          answer: input.answer,
          status: input.status,
          decidedBy: input.decidedBy,
          links,
        });
        return text(
          `Updated PM card ${card.id}: ${card.kind}, ${card.status}.`,
        );
      },
    }),
    define({
      name: "pm_card_decide",
      description:
        "Record a decision you made alone on one of your PM cards (decidedBy pm), with the decision text or the answer. Pass a non-empty decision or answer, or one of the card's options; a proposal or a decision is never closed empty. Use it for the calls that are yours, not for the user's: the user decides a proposal on the card itself, and the board records it with decidedBy user. When you answer a user's decision message, use pm_card_update or pm_card_decide to close the card.",
      input: z.object({
        id: z.string(),
        decision: z.string().max(5000).nullable().optional(),
        answer: z.string().max(5000).nullable().optional(),
        answerOptionId: z.string().max(40).nullable().default(null),
      }),
      async execute({ id, decision, answer, answerOptionId }) {
        if (!decision?.trim() && !answer?.trim() && !answerOptionId)
          throw new Error(
            "Pass a non-empty decision or answer: a PM card cannot be decided without one.",
          );
        const card = await board().pmCardDecide(id, {
          optionId: answerOptionId,
          decision,
          answer,
          by: "pm",
        });
        return text(`Decided PM card ${card.id}: "${card.decision ?? ""}".`);
      },
    }),
    define({
      name: "pm_card_archive",
      description:
        "Archive one of your PM cards. Nothing is deleted; an archived card stays in the Arquivado column.",
      input: z.object({ id: z.string() }),
      async execute({ id }) {
        const card = await board().pmCardArchive(id);
        return text(`Archived PM card ${card.id}: "${card.title}".`);
      },
    }),
  ];
}
