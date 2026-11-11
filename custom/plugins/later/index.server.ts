import type { PluginServerContext } from "@getpaseo/plugin/server";
import { sendLater } from "./server/schedule";
import { sendLaterRpc } from "./shared/later";

export default function contribute(server: PluginServerContext) {
  server.handle(sendLaterRpc, sendLater);
  return () => {};
}
