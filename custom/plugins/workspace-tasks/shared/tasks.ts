import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const TASK_NOTE_TIMELINE_KIND = "workspace-task-note";
export const TASK_NOTE_TIMELINE_VERSION = 1;

/** `active` is the task an agent is working on; each agent has at most one. */
export const taskStatusSchema = z.enum(["pending", "active", "done"]);

export const taskSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: taskStatusSchema,
  /** The agent the task was sent to. Null until it is sent. */
  agentId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const workspaceTasksSchema = z.object({
  tasks: z.array(taskSchema),
  /** The agent that gets the next task each time a turn completes. */
  autoAgentId: z.string().nullable(),
});

export type Task = z.output<typeof taskSchema>;
export type TaskStatus = z.output<typeof taskStatusSchema>;
export type WorkspaceTasks = z.output<typeof workspaceTasksSchema>;

export const taskNoteTimelineSchema = z.object({ text: z.string() });
export type TaskNoteTimelineData = z.output<typeof taskNoteTimelineSchema>;

const workspaceInput = { workspaceId: z.string().min(1) };
/** When set, the daemon posts a note about the change in that agent's chat. */
const noteAgentInput = { noteAgentId: z.string().min(1).optional() };

export const listTasksRpc = defineRpc({
  name: "list",
  input: z.object(workspaceInput),
  output: workspaceTasksSchema,
});

export const addTaskRpc = defineRpc({
  name: "add",
  input: z.object({ ...workspaceInput, ...noteAgentInput, text: z.string().min(1) }),
  output: workspaceTasksSchema,
});

export const updateTaskRpc = defineRpc({
  name: "update",
  input: z.object({
    ...workspaceInput,
    id: z.string().min(1),
    text: z.string().min(1).optional(),
    status: taskStatusSchema.optional(),
  }),
  output: workspaceTasksSchema,
});

export const removeTaskRpc = defineRpc({
  name: "remove",
  input: z.object({ ...workspaceInput, id: z.string().min(1) }),
  output: workspaceTasksSchema,
});

export const moveTaskRpc = defineRpc({
  name: "move",
  input: z.object({ ...workspaceInput, id: z.string().min(1), offset: z.number().int() }),
  output: workspaceTasksSchema,
});

export const clearDoneTasksRpc = defineRpc({
  name: "clear-done",
  input: z.object(workspaceInput),
  output: workspaceTasksSchema,
});

export const nextTaskRpc = defineRpc({
  name: "next",
  input: z.object({ ...workspaceInput, agentId: z.string().min(1) }),
  output: z.object({
    /** `queued`: the agent is busy; the task is sent when its turn ends. */
    result: z.enum(["sent", "queued", "empty"]),
    task: taskSchema.nullable(),
  }),
});

export const setAutoNextRpc = defineRpc({
  name: "set-auto",
  input: z.object({
    ...workspaceInput,
    agentId: z.string().min(1),
    /** Omit to toggle. */
    enabled: z.boolean().optional(),
  }),
  output: workspaceTasksSchema,
});
