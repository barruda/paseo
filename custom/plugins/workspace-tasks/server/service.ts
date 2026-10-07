import { randomUUID } from "node:crypto";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  type addTaskRpc,
  type nextTaskRpc,
  type setAutoNextRpc,
  TASK_NOTE_TIMELINE_KIND,
  TASK_NOTE_TIMELINE_VERSION,
  type Task,
  type WorkspaceTasks,
} from "../shared/tasks";
import { addTask, advance, taskPrompt } from "./model";
import type { TaskStore } from "./store";

type Paseo = PluginHandlerContext["paseo"];

interface TurnEndedEvent {
  agent: { id: string; workspaceId: string | null; parentAgentId: string | null };
  outcome: { kind: "completed" | "failed" | "canceled" };
}

export class TaskService {
  /** Agents that asked for the next task while busy, with the workspace to take it from. */
  private readonly queuedNext = new Map<string, string>();

  constructor(private readonly store: TaskStore) {}

  async add(input: RpcInput<typeof addTaskRpc>, paseo: Paseo): Promise<WorkspaceTasks> {
    const { state } = await this.store.update(input.workspaceId, (current) => ({
      state: addTask(current, { id: randomUUID(), text: input.text }, new Date().toISOString()),
      result: null,
    }));
    if (input.noteAgentId) {
      const pending = state.tasks.filter((task) => task.status === "pending").length;
      await note(paseo, input.noteAgentId, `Added task: ${input.text.trim()} (${pending} pending)`);
    }
    return state;
  }

  async next(
    input: RpcInput<typeof nextTaskRpc>,
    paseo: Paseo,
  ): Promise<RpcOutput<typeof nextTaskRpc>> {
    const agent = paseo.agents.ref(input.agentId);
    await agent.refresh();
    if (agent.status === "running") {
      this.queuedNext.set(input.agentId, input.workspaceId);
      await note(paseo, input.agentId, "The next task will be sent when this turn ends.");
      return { result: "queued", task: null };
    }
    const task = await this.sendNext(input.workspaceId, input.agentId, paseo);
    return { result: task ? "sent" : "empty", task };
  }

  async setAuto(input: RpcInput<typeof setAutoNextRpc>, paseo: Paseo): Promise<WorkspaceTasks> {
    const { state, result: enabled } = await this.store.update(input.workspaceId, (current) => {
      const turnOn = input.enabled ?? current.autoAgentId !== input.agentId;
      return {
        state: turnOn
          ? { ...current, autoAgentId: input.agentId }
          : withoutAutoAgent(current, input.agentId),
        result: turnOn,
      };
    });
    await note(
      paseo,
      input.agentId,
      enabled
        ? "Auto-next on: this agent gets the next task each time a turn completes. Run /autonext again to stop."
        : "Auto-next off.",
    );
    return state;
  }

  async onTurnEnded(event: TurnEndedEvent, paseo: Paseo): Promise<void> {
    const agentId = event.agent.id;
    const queuedWorkspace = this.queuedNext.get(agentId);
    this.queuedNext.delete(agentId);
    // A failed or interrupted turn didn't finish its task; leave it active.
    if (event.outcome.kind !== "completed") return;
    if (queuedWorkspace) {
      await this.sendNext(queuedWorkspace, agentId, paseo);
      return;
    }
    const workspaceId = event.agent.workspaceId;
    if (!workspaceId || event.agent.parentAgentId) return;
    const state = await this.store.read(workspaceId);
    if (state.autoAgentId !== agentId) return;
    const task = await this.sendNext(workspaceId, agentId, paseo);
    if (!task) {
      await this.store.update(workspaceId, (current) => ({
        state: withoutAutoAgent(current, agentId),
        result: null,
      }));
    }
  }

  /** Finishes the agent's active task and sends it the next pending one. */
  private async sendNext(workspaceId: string, agentId: string, paseo: Paseo): Promise<Task | null> {
    const now = new Date().toISOString();
    const { result } = await this.store.update(workspaceId, (current) => {
      const outcome = advance(current, agentId, now);
      return { state: outcome.state, result: outcome };
    });
    if (!result.task) {
      await note(
        paseo,
        agentId,
        "Task list is empty. Add tasks with /task <text> or the Tasks panel.",
      );
      return null;
    }
    const task = result.task;
    try {
      await paseo.agents.ref(agentId).send(taskPrompt(task, result.remaining));
    } catch (error) {
      // Put the task back so it isn't stuck as active on an agent that never got it.
      await this.store.update(workspaceId, (current) => ({
        state: {
          ...current,
          tasks: current.tasks.map((item) =>
            item.id === task.id ? { ...item, status: "pending", agentId: null } : item,
          ),
        },
        result: null,
      }));
      throw error;
    }
    return task;
  }
}

function withoutAutoAgent(state: WorkspaceTasks, agentId: string): WorkspaceTasks {
  return state.autoAgentId === agentId ? { ...state, autoAgentId: null } : state;
}

async function note(paseo: Paseo, agentId: string, text: string): Promise<void> {
  try {
    await paseo.agents.ref(agentId).timeline.append({
      type: "plugin",
      id: `task-note-${randomUUID()}`,
      kind: TASK_NOTE_TIMELINE_KIND,
      version: TASK_NOTE_TIMELINE_VERSION,
      data: { text },
    });
  } catch (error) {
    console.error(`[workspace-tasks] failed to post a note to ${agentId}`, error);
  }
}
