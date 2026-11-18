// CUSTOM(projects-assistant): the Projects Assistant chat. A real Paseo agent, started in an empty
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
import type {
  AssistantActionInput,
  HistoryEvent,
} from "../../shared/assistant";
import type { HistoryQuery } from "./history";
import { buildOverview, readConversation } from "./views";
import type { Workboard } from "../workboard";
// CUSTOM(assistant-quick)
import { ACK_MESSAGE_MAX, normalizeAckStatus } from "../../shared/quick";
import type { QuickInbox } from "./quick";

export const CHAT_LABEL = "pwb/assistant-chat";

// CUSTOM(agent-profiles): the role text is the seed of the assistant profile's system-prompt.md;
// from then on that file is the source of truth and the chat's first message is only CHAT_INSTRUCTIONS.
export const ASSISTANT_ROLE = [
  "You are the Projects Assistant: the user's manager for their Power Workboard tasks and orchestrators, in Tasks mode.",
  "You work ONLY through your board tools (board_overview, board_list_tasks, board_get_task, board_create_task, board_update_task, board_move_task, board_task_action, board_run_orchestrator, board_history, board_read_agent, board_ack). Do not edit files, run shell commands, use git, or create Paseo agents for task work: tasks go through the board so the orchestrators run them.",
  "New tasks go to the Backlog unless the user asks to start them now; then create them with start=true so they land in the Ready to start column and an orchestrator picks them up.",
  "Write each task description as a complete ticket: goal, context, acceptance criteria and what is out of scope. If the project or the goal is unclear, ask one short question before creating the task.",
  "Before board_task_action with merge-now or mark-done, say what will happen and what you are about to do.",
  "Answer in the user's language, briefly.",
].join("\n\n");

/** Added to the seed: the one exception to "do not edit files". */
export const ASSISTANT_MEMORY_NOTE =
  "You may use Write, Edit and Bash only to keep your memory folder up to date; never to change anything else.";

export const ASSISTANT_SEED_PROMPT = `${ASSISTANT_ROLE}\n\n${ASSISTANT_MEMORY_NOTE}`;

/** The chat's first message; the role itself is in the profile's system prompt. */
export const CHAT_INSTRUCTIONS =
  "Reply with one short line saying you're ready. Your board tools are board_overview, board_list_tasks, board_get_task, board_create_task, board_update_task, board_move_task, board_task_action, board_run_orchestrator, board_history, board_read_agent and board_ack. Messages that start with [Quick message <id> ...] come from outside this chat; call board_ack first, before any other tool.";

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
  const card = (taskId: string): Card => {
    const found = board()
      .snapshot()
      .cards.find((c) => c.id === taskId);
    if (!found) throw new Error(`No task with id ${taskId}`);
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
    `${c.id} | ${c.title} | project: ${c.projectName || c.projectId || "-"} | column: ${columnOf(c)} (${c.stage}) | orchestrator: ${orchestratorName(c.orchestratorId)} | delivery: ${delivery(c.id)?.stage ?? "-"} | updated: ${c.updatedAt}`;
  const managedAgent = (agentId: string) => {
    const data = board().assistantSource().data;
    return (
      Object.values(data.orchestrations).some((o) => o.agentId === agentId) ||
      Object.values(data.assistant.attempts).some((list) =>
        list.some((a) => a.agentId === agentId),
      )
    );
  };

  return [
    define({
      name: "board_overview",
      description:
        "Overview of the Power Workboard: projects, orchestrators, columns with task counts, the tasks that need the user, and the Projects Assistant settings.",
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
        const lines = [
          `Projects:\n${snapshot.projects.map((p) => `- ${p.id} | ${p.name} | ${p.isGit ? "git" : "not git"} | ${p.directory}`).join("\n") || "- none"}`,
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
                `- ${g.id} | ${groupName(g)} | ${g.kind} | ${snapshot.cards.filter((c) => c.stage === g.id).length} tasks`,
            )
            .join("\n")}`,
          `Needs you:\n${needsYou.map((n) => `- ${n.taskId} | ${n.title} | project: ${n.projectName || n.projectId || "-"} | orchestrator: ${n.orchestratorName ?? "-"} | agent: ${n.agentId ?? "-"} | attempt: ${n.attempt ?? "-"} | since: ${n.since} | can merge: ${n.canMerge ? "yes" : "no"} | ${n.reason}${n.detail ? `: ${n.detail}` : ""}`).join("\n") || "- nothing"}`,
          `Assistant: ${settings.enabled ? "on" : "off"}, default action ${settings.defaultAction}; per project: ${
            Object.entries(settings.projects)
              .map(
                ([id, p]) =>
                  `${id}=${p.action}${p.observe ? " (observe)" : ""}`,
              )
              .join(", ") || "none"
          }`,
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
        "Everything about one task: description, column, attempts, delivery, last summary, PR text.",
      input: z.object({ taskId: z.string() }),
      async execute({ taskId }) {
        const c = card(taskId);
        const data = board().assistantSource().data;
        const run = data.orchestrations[taskId];
        const d = data.assistant.deliveries[taskId];
        const finish = data.finishes[taskId];
        const attempts = data.assistant.attempts[taskId] ?? [];
        const parts = [
          line(c),
          `Description:\n${c.description || "(empty)"}`,
          `Run: ${run ? `${run.status}, agent ${run.agentId ?? "-"}${run.error ? `, error: ${run.error}` : ""}` : "none"}`,
          `Last summary: ${run?.summary ?? "-"}`,
          `Attempts:\n${attempts.map((a) => `- #${a.index} ${a.trigger} | agent ${a.agentId ?? "-"} | ${a.outcome}${a.feedback ? ` | feedback: ${a.feedback}` : ""}`).join("\n") || "- none"}`,
          d
            ? `Delivery: ${d.stage}, action ${d.action}${d.reason ? `, reason ${d.reason}` : ""}${d.detail ? ` (${d.detail})` : ""}${d.report ? `\nReport: ${d.report.status}: ${d.report.summary}${d.report.risks.length ? `\nRisks: ${d.report.risks.join("; ")}` : ""}${d.report.question ? `\nQuestion: ${d.report.question}` : ""}` : ""}`
            : "Delivery: none",
          finish?.prTitle || finish?.prBody
            ? `Prepared PR: ${finish.prTitle ?? ""}\n${finish.prBody ?? ""}`
            : "",
          finish?.mergedAt ? `Merged at ${finish.mergedAt}` : "",
        ];
        return text(parts.filter(Boolean).join("\n\n"));
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
        const after = await board().mutate({
          action: "create",
          title: input.title,
          description: input.description,
          projectId,
          ...(orchestratorId ? { orchestratorId } : {}),
          stage,
        });
        const created = after.cards.find((c) => !before.has(c.id));
        if (!created) throw new Error("The task was not created");
        return text(
          `Created ${created.id} "${created.title}" in ${columnOf(created)} (${created.stage}), project: ${created.projectName || created.projectId || "-"}.`,
        );
      },
    }),
    define({
      name: "board_update_task",
      description:
        "Change a task's title, description, project (id or name) or orchestrator (id or name). Omitted fields stay as they are; null clears the project or orchestrator.",
      input: z.object({
        taskId: z.string(),
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
        await board().mutate({
          action: "edit",
          taskId: c.id,
          updatedAt: c.updatedAt,
          title: input.title ?? c.title,
          description: input.description ?? c.description,
          projectId: projectId !== undefined ? projectId : c.projectId,
          ...(orchestratorId !== undefined ? { orchestratorId } : {}),
        });
        return text(`Updated ${c.id}.`);
      },
    }),
    define({
      name: "board_move_task",
      description:
        "Move a task to a column (group id or kind), like dragging its card. The board refuses moves it does not allow, such as putting a task that has no workspace into In progress.",
      input: z.object({ taskId: z.string(), column: z.string() }),
      async execute({ taskId, column }) {
        const c = card(taskId);
        const group = resolveGroup(column);
        await board().mutate({
          action: "stage",
          taskId: c.id,
          stage: group.id,
          expectedLabels: c.managedLabels,
          expectedUpdatedAt: c.updatedAt,
          expectedGroup: { id: group.id, kind: group.kind, label: group.label },
        });
        return text(`Moved ${c.id} to ${groupName(group)}.`);
      },
    }),
    define({
      name: "board_task_action",
      description:
        "Act on a task that is in review or done: merge-now (commit and merge into the base branch), prepare-pr, continue (send it back to its agent with feedback), mark-done, or dismiss (take it off Needs you).",
      input: z.object({
        taskId: z.string(),
        type: z.enum([
          "merge-now",
          "prepare-pr",
          "continue",
          "mark-done",
          "dismiss",
        ]),
        feedback: z.string().max(20000).optional(),
      }),
      async execute(input) {
        const action: AssistantActionInput =
          input.type === "continue"
            ? {
                type: "continue",
                taskId: input.taskId,
                feedback: input.feedback ?? "",
              }
            : { type: input.type, taskId: input.taskId };
        await board().assistantAction(action);
        return text(
          input.type === "merge-now" || input.type === "prepare-pr"
            ? `Started ${input.type} for ${input.taskId}; it runs in the background. Check board_get_task for the result.`
            : `Done: ${input.type} for ${input.taskId}.`,
        );
      },
    }),
    define({
      name: "board_run_orchestrator",
      description:
        "Run an orchestrator now (Run now): it takes one batch from Ready to start.",
      input: z.object({ orchestratorId: z.string() }),
      async execute({ orchestratorId }) {
        await board().mutate({
          action: "orchestrator-run",
          id: orchestratorId,
        });
        return text(`Orchestrator ${orchestratorId} is running.`);
      },
    }),
    define({
      name: "board_history",
      description:
        "The Projects Assistant's history, newest first, one line per event.",
      input: z.object({
        limit: z.number().int().min(1).max(50).default(20),
        taskId: z.string().optional(),
        projectId: z.string().optional().describe("A project's id or name"),
      }),
      async execute(input) {
        const projectId = input.projectId
          ? resolveProject(input.projectId)
          : null;
        const page = await history.list({
          cursor: null,
          limit: input.limit,
          projectId,
          orchestratorId: null,
          taskId: input.taskId ?? null,
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
  ];
}
