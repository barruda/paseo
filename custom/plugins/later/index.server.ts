import type { PluginServerContext } from "@getpaseo/plugin/server";
import { cancelLater, listLater, sendLater } from "./server/schedule";
import { cancelLaterRpc, listLaterRpc, sendLaterRpc } from "./shared/later";

export default function contribute(server: PluginServerContext) {
  server.handle(sendLaterRpc, sendLater);
  server.handle(listLaterRpc, listLater);
  server.handle(cancelLaterRpc, cancelLater);
  return () => {};
}
