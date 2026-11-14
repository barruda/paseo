import { randomUUID } from "node:crypto";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  JEV_LABELS,
  JEV_TIMELINE_KIND,
  JEV_TIMELINE_VERSION,
  JEV_UPGRADE_TIMELINE_KIND,
  JEV_UPGRADE_TIMELINE_VERSION,
  needsUpgradeCheck,
  planEffortUpgrade,
  upgradeCandidates,
} from "@getpaseo/protocol/jev-router";
import {
  applyEffortFocused,
  applyModelFocused,
  buildRouteCard,
  planRoute,
  resolveHome,
} from "./shared/decision";
import { routeRpc, routerSettings, upgradeRpc } from "./shared/settings";
import { runRouter } from "./server/run";
import { RouteCardStash } from "./server/stash";

// The app calls `route` right before it creates a session from a draft composer's first message
// (never for automations or follow-ups). Off, a non-Claude provider or (model focused) Haiku answer `skipped`; a
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
    const home = resolveHome({ ...input, mode: values.mode });
    if ("skip" in home) return { status: "skipped" as const, reason: home.skip };
    const routeId = randomUUID();
    try {
      const raw = await runRouter({
        settings: values,
        home,
        prompt: input.prompt,
        cwd: input.cwd,
        images: input.images,
        test: input.test,
      });
      const decision = applyModelFocused(applyEffortFocused(raw, values), values, home);
      const plan = planRoute({
        decision,
        home,
        test: input.test,
        routeId,
        mode: values.mode,
        homeModelId: input.model,
      });
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
        mode: values.mode,
        homeModelId: input.model,
      });
    }
  });

  // "Upgrade effort mid-session": before a follow-up to an idle Claude session, ask Jev (effort
  // focused policy, nothing logged) whether the message is hard; if so raise the effort, never
  // lower it or change the model, and leave a card. Fail-open: any problem answers `skipped`.
  server.handle(upgradeRpc, async (input, context) => {
    const state = await settings.read();
    if (state.status !== "ready") return { status: "skipped" as const, reason: state.error };
    const values = state.values;
    const setting = values.upgradeEffort;
    if (!setting.enabled) return { status: "skipped" as const, reason: "off" };
    if (input.provider !== "claude")
      return { status: "skipped" as const, reason: `provider ${input.provider}` };
    const currentEffort = input.thinkingOptionId;
    if (
      !currentEffort ||
      !needsUpgradeCheck({ setting, currentEffort, availableEfforts: input.availableEfforts })
    )
      return { status: "skipped" as const, reason: "nothing to raise" };
    const home = resolveHome({
      provider: input.provider,
      model: input.model,
      thinkingOptionId: currentEffort,
      mode: "effort",
    });
    if ("skip" in home) return { status: "skipped" as const, reason: home.skip };
    try {
      const decision = await runRouter({
        settings: values,
        home,
        prompt: input.prompt,
        cwd: input.cwd,
        images: input.images,
        test: false,
        upgrade: true,
      });
      if (decision.error) return { status: "skipped" as const, reason: decision.error };
      const target = planEffortUpgrade({
        currentEffort,
        candidates: upgradeCandidates(setting, input.availableEfforts),
        why: decision.why,
        jevEffort: decision.jevEffort,
      });
      if (target && input.model) {
        await context.paseo.agents.ref(input.agentId).timeline.append({
          type: "plugin",
          id: `jev-upgrade-${randomUUID()}`,
          kind: JEV_UPGRADE_TIMELINE_KIND,
          version: JEV_UPGRADE_TIMELINE_VERSION,
          data: {
            modelId: input.model,
            fromEffort: currentEffort,
            toEffort: target,
            why: decision.why,
            jevEffort: decision.jevEffort ?? null,
          },
        });
      }
      return {
        status: "checked" as const,
        decision,
        upgraded: target !== null && Boolean(input.model),
        from: currentEffort,
        to: target,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[jev-router] upgrade: ${message}`);
      return { status: "skipped" as const, reason: message };
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
