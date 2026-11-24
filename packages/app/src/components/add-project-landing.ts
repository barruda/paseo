// CUSTOM(add-project-settings): in Tasks mode, adding a project leaves the user where they were
// (Settings > Projects, with the new project in the list). Outside Tasks mode the flow keeps
// upstream's landing on the New workspace screen for the project.
import { useTaskNavigationStore } from "@/task-navigation/store";

export function opensNewWorkspaceAfterAddProject(): boolean {
  return !useTaskNavigationStore.getState().enabled;
}
