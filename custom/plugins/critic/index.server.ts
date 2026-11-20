import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { defineRpc } from "@getpaseo/plugin";
import {
  CRITIC_RPC,
  CriticGetConfigInputSchema,
  CriticGetConfigOutputSchema,
  CriticSetConfigInputSchema,
  CriticSetConfigOutputSchema,
} from "@getpaseo/protocol/critic";
import { CriticLoop } from "./server/loop";
import { createSetCriticTool, shouldAttachCriticTool } from "./server/set-critic";
import { CriticStore, defaultStoreFile } from "./server/store";

const getConfigRpc = defineRpc({
  name: CRITIC_RPC.getConfig,
  input: CriticGetConfigInputSchema,
  output: CriticGetConfigOutputSchema,
});

const setConfigRpc = defineRpc({
  name: CRITIC_RPC.setConfig,
  input: CriticSetConfigInputSchema,
  output: CriticSetConfigOutputSchema,
});

export default function contribute(server: PluginServerContext) {
  const store = new CriticStore(defaultStoreFile());
  // Hooks and RPC handlers share one daemon connection for the plugin's life.
  let paseo: PluginHookContext["paseo"] | null = null;
  const loop = new CriticLoop(store, () => {
    if (!paseo) throw new Error("The critic plugin has no daemon connection yet");
    return paseo;
  });

  server.handle(getConfigRpc, (input, context) => {
    paseo = context.paseo;
    return store.get(input.agentId);
  });
  server.handle(setConfigRpc, async (input) => {
    await store.set(input);
    return { ok: true as const };
  });
  const removeTurnEnded = server.on("agent.turn_ended", (event, context) => {
    paseo = context.paseo;
    loop.onTurnEnded(event);
  });
  const removePermission = server.on("agent.permission_requested", (event, context) => {
    paseo = context.paseo;
    loop.onPermissionRequested(event);
  });
  const setCritic = createSetCriticTool(store);
  const removeSessionOpen = server.before("agent.session_open", ({ request }) => {
    if (!shouldAttachCriticTool(request)) return;
    return { ...request, tools: [...request.tools, setCritic] };
  });
  return () => {
    removeTurnEnded();
    removePermission();
    removeSessionOpen();
  };
}
