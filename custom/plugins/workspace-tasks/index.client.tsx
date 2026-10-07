import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TaskNote } from "./client/task-note";
import { TaskPanel } from "./client/task-panel";
import {
  addTaskRpc,
  nextTaskRpc,
  setAutoNextRpc,
  TASK_NOTE_TIMELINE_KIND,
  TASK_NOTE_TIMELINE_VERSION,
  taskNoteTimelineSchema,
} from "./shared/tasks";

const PANEL_ID = "tasks";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Task list",
      icon: "ListTodo",
      context: "workspace",
      locations: ["workspace", "explorer"],
      Component: TaskPanel,
    }),
    client.addCommandCenterItem({
      id: "open-tasks",
      title: "Open task list",
      icon: "ListTodo",
      keywords: ["tasks", "todo", "backlog", "next"],
      context: "workspace",
      onSelect: ({ openPanel }) => openPanel(PANEL_ID),
    }),
    client.addSlashCommand({
      name: "task",
      description: "Add a task to this workspace's task list",
      argumentHint: "<text>",
      context: "agent",
      async onSubmit({ args, workspace, agent, rpc }) {
        if (!args) throw new Error("Type the task: /task fix the login bug");
        await rpc(addTaskRpc, { workspaceId: workspace.id, noteAgentId: agent.id, text: args });
      },
    }),
    client.addSlashCommand({
      name: "next",
      description: "Finish the current task and send this agent the next one from the task list",
      argumentHint: "",
      context: "agent",
      async onSubmit({ workspace, agent, rpc }) {
        await rpc(nextTaskRpc, { workspaceId: workspace.id, agentId: agent.id });
      },
    }),
    client.addSlashCommand({
      name: "autonext",
      description: "Toggle: send this agent the next task each time a turn completes",
      argumentHint: "",
      context: "agent",
      async onSubmit({ workspace, agent, rpc }) {
        await rpc(setAutoNextRpc, { workspaceId: workspace.id, agentId: agent.id });
      },
    }),
    client.addSlashCommand({
      name: "tasks",
      description: "Open this workspace's task list",
      argumentHint: "",
      context: "agent",
      onSubmit: ({ openPanel }) => openPanel(PANEL_ID),
    }),
    client.addTimelineRenderer({
      kind: TASK_NOTE_TIMELINE_KIND,
      version: TASK_NOTE_TIMELINE_VERSION,
      schema: taskNoteTimelineSchema,
      Component: TaskNote,
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
