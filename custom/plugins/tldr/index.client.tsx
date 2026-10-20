import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeTldrPills } from "./client/pills";

export default function contribute(client: PluginClientContext) {
  return contributeTldrPills(client);
}
