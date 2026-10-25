import type { PluginServerContext } from "@getpaseo/plugin/server";
import { askBtw, followUpBtw } from "./server/ask";
import { askBtwRpc, followUpBtwRpc } from "./shared/btw";

export default function contribute(server: PluginServerContext) {
  server.handle(askBtwRpc, askBtw);
  server.handle(followUpBtwRpc, followUpBtw);
  return () => {};
}
