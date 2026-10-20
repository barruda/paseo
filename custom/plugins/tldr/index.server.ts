import type { PluginServerContext } from "@getpaseo/plugin/server";

// The pill sends "TLDR" to the agent from the client; nothing runs on the daemon.
export default function contribute(_server: PluginServerContext) {
  return () => {};
}
