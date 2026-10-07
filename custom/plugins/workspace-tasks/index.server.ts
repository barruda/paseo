import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  addTaskRpc,
  clearDoneTasksRpc,
  listTasksRpc,
  moveTaskRpc,
  nextTaskRpc,
  removeTaskRpc,
  setAutoNextRpc,
  updateTaskRpc,
  type WorkspaceTasks,
} from "./shared/tasks";
import { clearDoneTasks, moveTask, removeTask, updateTask } from "./server/model";
import { TaskService } from "./server/service";
import { defaultTasksFile, TaskStore } from "./server/store";

export default function contribute(server: PluginServerContext) {
  const store = new TaskStore(defaultTasksFile());
  const service = new TaskService(store);
  const now = () => new Date().toISOString();
  const save = async (workspaceId: string, change: (state: WorkspaceTasks) => WorkspaceTasks) =>
    (await store.update(workspaceId, (state) => ({ state: change(state), result: null }))).state;

  server.handle(listTasksRpc, ({ workspaceId }) => store.read(workspaceId));
  server.handle(addTaskRpc, (input, { paseo }) => service.add(input, paseo));
  server.handle(updateTaskRpc, ({ workspaceId, id, text, status }) =>
    save(workspaceId, (state) => updateTask(state, id, { text, status }, now())),
  );
  server.handle(removeTaskRpc, ({ workspaceId, id }) =>
    save(workspaceId, (state) => removeTask(state, id)),
  );
  server.handle(moveTaskRpc, ({ workspaceId, id, offset }) =>
    save(workspaceId, (state) => moveTask(state, id, offset)),
  );
  server.handle(clearDoneTasksRpc, ({ workspaceId }) => save(workspaceId, clearDoneTasks));
  server.handle(nextTaskRpc, (input, { paseo }) => service.next(input, paseo));
  server.handle(setAutoNextRpc, (input, { paseo }) => service.setAuto(input, paseo));
  server.on("agent.turn_ended", (event, { paseo }) => service.onTurnEnded(event, paseo));
  return () => {};
}
