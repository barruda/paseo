import type { PluginServerContext } from "@getpaseo/plugin/server";
import { defaultBridgeConfig, WarpBridge } from "./server/bridge";
import { openWarpSessionRpc } from "./shared/warp";

export default function contribute(server: PluginServerContext) {
  const bridge = new WarpBridge(defaultBridgeConfig());
  server.handle(openWarpSessionRpc, async ({ cwd }) => ({ url: await bridge.open(cwd) }));
  // On boot, Warp tabs from the last session reload before anyone opens a new one.
  bridge.start().catch((error: unknown) => {
    console.error(`[warp] bridge did not start: ${error instanceof Error ? error.message : error}`);
  });
  return () => bridge.stop();
}
