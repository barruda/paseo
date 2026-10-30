import type { PluginServerContext } from "@getpaseo/plugin/server";
import { tldrSettings } from "./shared/tldr";

// The daemon only stores the saved message; the pill and /tldr send it from the client.
export default function contribute(server: PluginServerContext) {
  server.registerSettings(tldrSettings);
  return () => {};
}
