import type { PluginClientContext } from "@getpaseo/plugin/client";

// Contributes nothing: the editor lives on the Pi provider page (packages/app/src/pi-models). The
// app only lists plugins that ship a client bundle, and the page finds this one through that list.
export default function contribute(_client: PluginClientContext) {
  return () => {};
}
