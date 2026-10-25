import type {
  PluginClientContext,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkboardScreen } from "./client/WorkboardScreen";
import { writeTicketRpc } from "./shared/rpc";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 2_000 } },
});

const Surface = (props: Parameters<typeof WorkboardScreen>[0]) => (
  <QueryClientProvider client={queryClient}>
    <WorkboardScreen {...props} />
  </QueryClientProvider>
);
// CUSTOM(workboard-tab): the board as a workspace tab, from the "+" new-tab menu or the Command
// Center. It shows the whole board, not just this workspace's tasks.
const PanelSurface = (props: PluginWorkspacePanelProps) => (
  <QueryClientProvider client={queryClient}>
    <WorkboardScreen {...props} />
  </QueryClientProvider>
);
const SettingsSurface = (props: Parameters<typeof WorkboardScreen>[0]) => (
  <QueryClientProvider client={queryClient}>
    <WorkboardScreen {...props} initialPage="settings" />
  </QueryClientProvider>
);

export default function contribute(client: PluginClientContext) {
  const removeSurface = client.addSurface("power-workboard", Surface);
  const removeSidebar = client.addSidebarItem({
    id: "power-workboard",
    title: "Power Workboard",
    icon: "Workflow",
    surface: "power-workboard",
  });
  const removeSettings = client.addSettingsScreen({
    id: "power-workboard-settings",
    title: "Power Workboard",
    icon: "Settings",
    Component: SettingsSurface,
  });
  // CUSTOM(workboard-tab)
  const removePanel = client.addWorkspacePanel({
    id: "power-workboard",
    title: "Power Workboard",
    icon: "Workflow",
    context: "workspace",
    locations: ["workspace"],
    Component: PanelSurface,
  });
  const removeTabCommand = client.addCommandCenterItem({
    id: "power-workboard-open-tab",
    title: "Open Power Workboard tab",
    icon: "Workflow",
    keywords: ["power", "workboard", "orchestrator", "kanban", "tab"],
    context: "workspace",
    onSelect: ({ openPanel }) => openPanel("power-workboard"),
  });
  const removeCommand = client.addCommandCenterItem({
    id: "power-workboard-open",
    title: "Power Workboard",
    icon: "Workflow",
    keywords: ["power", "workboard", "orchestrator", "tasks"],
    context: "global",
    onSelect: (context) => context.openSurface("power-workboard"),
  });
  const removeWriteTicket = client.addSlashCommand({
    name: "write-ticket",
    description:
      "Power Workboard: close this refinement and write the ticket into the task.",
    argumentHint: "[what to focus on]",
    context: "agent",
    async onSubmit({ args, agent, rpc }) {
      await rpc(writeTicketRpc, { agentId: agent.id, focus: args });
    },
  });
  return () => {
    removeWriteTicket();
    removeTabCommand();
    removePanel();
    removeCommand();
    removeSettings();
    removeSidebar();
    removeSurface();
  };
}
