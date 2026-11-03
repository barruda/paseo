import { randomUUID } from "node:crypto";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { JEV_LABELS, JEV_TIMELINE_KIND, JEV_TIMELINE_VERSION } from "@getpaseo/protocol/jev-router";
import { buildRouteCard, planRoute, resolveHome } from "./shared/decision";
import { routeRpc, routerSettings } from "./shared/settings";
import { runRouter } from "./server/run";
import { RouteCardStash } from "./server/stash";

// The app calls `route` right before it creates a session from a draft composer's first message
// (never for automations or follow-ups). Off, a non-Claude provider or Haiku answer `skipped`; a
// router failure answers `routed` with the error and the selected model kept (fail-open). When the
// model changed, the new agent gets a short card saying so, with a button to undo it.
export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(routerSettings);
  const stash = new RouteCardStash();

  server.handle(routeRpc, async (input) => {
    const state = await settings.read();
    if (state.status !== "ready") return { status: "skipped" as const, reason: state.error };
    const values = state.values;
    if (!values.enabled && !input.test) return { status: "skipped" as const, reason: "off" };
    const home = resolveHome(input);
    if ("skip" in home) return { status: "skipped" as const, reason: home.skip };
    const routeId = randomUUID();
    try {
      const decision = await runRouter({
        settings: values,
        home,
        prompt: input.prompt,
        cwd: input.cwd,
        images: input.images,
        test: input.test,
      });
      const plan = planRoute({ decision, home, test: input.test, routeId });
      if (plan.applied && input.model)
        stash.put(
          routeId,
          buildRouteCard({
            prompt: input.prompt,
            decision,
            homeModelId: input.model,
            homeThinkingOptionId: input.thinkingOptionId,
          }),
        );
      return plan;
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
        test: input.test,
        routeId,
      });
    }
  });

  const removeCreated = server.on("agent.created", async (event, context) => {
    const agent = context.paseo.agents.ref(event.agent.id);
    const snapshot = await agent.refresh();
    const routeId = snapshot?.agent.labels[JEV_LABELS.routeId];
    const card = routeId ? stash.take(routeId) : null;
    if (!card) return;
    await agent.timeline.append({
      type: "plugin",
      id: `jev-route-${routeId}`,
      kind: JEV_TIMELINE_KIND,
      version: JEV_TIMELINE_VERSION,
      data: card,
    });
  });

  return () => removeCreated();
}
