import type { PluginServerContext } from "@getpaseo/plugin/server";
import { planRoute, resolveHome } from "./shared/decision";
import { routeRpc, routerSettings } from "./shared/settings";
import { runRouter } from "./server/run";

// The app calls `route` right before it creates a session from a draft composer's first message
// (never for automations or follow-ups). Disabled, a non-Claude provider or Haiku answer `skipped`;
// a router failure answers `routed` with the error and the selected model kept (fail-open).
export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(routerSettings);

  server.handle(routeRpc, async (input) => {
    const state = await settings.read();
    if (state.status !== "ready") return { status: "skipped" as const, reason: state.error };
    const values = state.values;
    if (!values.enabled && !input.test) return { status: "skipped" as const, reason: "disabled" };
    const home = resolveHome(input);
    if ("skip" in home) return { status: "skipped" as const, reason: home.skip };
    try {
      const decision = await runRouter({
        settings: values,
        home,
        prompt: input.prompt,
        cwd: input.cwd,
        images: input.images,
        test: input.test,
      });
      return planRoute({ decision, home, apply: values.apply && !input.test });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[jev-router] ${message}`);
      return planRoute({
        decision: {
          model: home.family,
          modelId: input.model ?? "",
          effort: home.effort,
          why: "error",
          latencyMs: null,
          error: message,
        },
        home,
        apply: false,
      });
    }
  });

  return () => undefined;
}
