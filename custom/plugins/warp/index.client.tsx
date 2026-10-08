import type { PluginClientContext } from "@getpaseo/plugin/client";
import { WarpPanel } from "./client/warp-panel";

const PANEL_ID = "warp";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Warp",
      icon: "SquareTerminal",
      context: "workspace",
      Component: WarpPanel,
    }),
    client.addCommandCenterItem({
      id: "open-warp",
      title: "Open Warp",
      icon: "SquareTerminal",
      keywords: ["warp", "terminal", "shell"],
      context: "workspace",
      onSelect: ({ openPanel }) => openPanel(PANEL_ID),
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
