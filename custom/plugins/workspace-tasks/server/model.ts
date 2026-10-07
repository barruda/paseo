import type { Task, TaskStatus, WorkspaceTasks } from "../shared/tasks";

export const EMPTY_WORKSPACE: WorkspaceTasks = { tasks: [], autoAgentId: null };

export function addTask(
  state: WorkspaceTasks,
  task: { id: string; text: string },
  now: string,
): WorkspaceTasks {
  const text = task.text.trim();
  if (!text) return state;
  return {
    ...state,
    tasks: [
      ...state.tasks,
      { id: task.id, text, status: "pending", agentId: null, createdAt: now, updatedAt: now },
    ],
  };
}

export function updateTask(
  state: WorkspaceTasks,
  id: string,
  patch: { text?: string; status?: TaskStatus },
  now: string,
): WorkspaceTasks {
  return {
    ...state,
    tasks: state.tasks.map((task) => {
      if (task.id !== id) return task;
      const next: Task = { ...task, updatedAt: now };
      if (patch.text?.trim()) next.text = patch.text.trim();
      if (patch.status) {
        next.status = patch.status;
        // A task put back in the backlog can go to any agent next time.
        if (patch.status === "pending") next.agentId = null;
      }
      return next;
    }),
  };
}

export function removeTask(state: WorkspaceTasks, id: string): WorkspaceTasks {
  return { ...state, tasks: state.tasks.filter((task) => task.id !== id) };
}

export function moveTask(state: WorkspaceTasks, id: string, offset: number): WorkspaceTasks {
  const from = state.tasks.findIndex((task) => task.id === id);
  if (from === -1) return state;
  const to = Math.max(0, Math.min(state.tasks.length - 1, from + offset));
  if (to === from) return state;
  const tasks = [...state.tasks];
  const [task] = tasks.splice(from, 1);
  tasks.splice(to, 0, task);
  return { ...state, tasks };
}

export function clearDoneTasks(state: WorkspaceTasks): WorkspaceTasks {
  return { ...state, tasks: state.tasks.filter((task) => task.status !== "done") };
}

/**
 * Marks the agent's active task done and makes the first pending task its new active task.
 * `task` is null when the backlog is empty; the finished task is still marked done.
 */
export function advance(
  state: WorkspaceTasks,
  agentId: string,
  now: string,
): { state: WorkspaceTasks; task: Task | null; remaining: number } {
  let picked: Task | null = null;
  const tasks = state.tasks.map((task): Task => {
    if (task.status === "active" && task.agentId === agentId) {
      return { ...task, status: "done", updatedAt: now };
    }
    return task;
  });
  const index = tasks.findIndex((task) => task.status === "pending");
  if (index !== -1) {
    picked = { ...tasks[index], status: "active", agentId, updatedAt: now };
    tasks[index] = picked;
  }
  const remaining = tasks.filter((task) => task.status === "pending").length;
  return { state: { ...state, tasks }, task: picked, remaining };
}

export function taskPrompt(task: Task, remaining: number): string {
  const after =
    remaining === 0
      ? "This is the last task in the list."
      : `${remaining} more task${remaining === 1 ? "" : "s"} after this one.`;
  return [
    "Next task from the workspace task list:",
    "",
    task.text,
    "",
    `(${after} When you finish, stop; the next task will be sent to you.)`,
  ].join("\n");
}
