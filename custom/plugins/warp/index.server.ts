import type { PluginServerContext } from "@getpaseo/plugin/server";
import { defaultBridgeConfig, WarpBridge } from "./server/bridge";
import { openWarpSessionRpc } from "./shared/warp";

export default function contribute(server: PluginServerContext) {
  const bridge = new WarpBridge(defaultBridgeConfig());
  server.handle(openWarpSessionRpc, async ({ cwd }) => ({ url: await bridge.open(cwd) }));
  return () => bridge.stop();
}
