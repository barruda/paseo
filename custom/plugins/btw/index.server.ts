import type { PluginServerContext } from "@getpaseo/plugin/server";
import { askBtw } from "./server/ask";
import { askBtwRpc } from "./shared/btw";

export default function contribute(server: PluginServerContext) {
  server.handle(askBtwRpc, askBtw);
  return () => {};
}
