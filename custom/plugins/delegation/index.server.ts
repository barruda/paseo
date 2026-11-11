import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  DELEGATION_TIMELINE_KIND,
  DELEGATION_TIMELINE_VERSION,
} from "@getpaseo/protocol/delegation";
import {
  DELEGATION_ENV,
  buildDelegationPolicy,
  delegationCardData,
  isDelegationEligible,
  withDelegationPolicy,
} from "./shared/policy";
import { delegationSettings } from "./shared/settings";
import { logDelegatedSession } from "./server/session-log";
import { DelegationTracker } from "./server/tracker";

// While delegation is on, a new Claude session on Opus or Fable gets the rule in its saved system
// prompt (so it survives resumes and keeps the prompt cache), and a card at the top of its chat.
// Sessions already open, other providers and cheaper models are left alone. Daemon-internal agents
// never reach these hooks.
export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(delegationSettings);
  const tracker = new DelegationTracker();

  const removeCreate = server.before("agent.create", async ({ request }) => {
    if (!isDelegationEligible(request.config)) return undefined;
    const state = await settings.read();
    if (state.status !== "ready" || !state.values.enabled) return undefined;
    const values = state.values;
    const id = tracker.begin(delegationCardData(values), request.config.model ?? null);
    return {
      ...request,
      config: {
        ...request.config,
        systemPrompt: withDelegationPolicy(
          request.config.systemPrompt,
          buildDelegationPolicy(values),
        ),
      },
      env: { ...request.env, [DELEGATION_ENV]: id },
    };
  });

  const removeOpen = server.before("agent.session_open", ({ request }) => {
    const id = request.reason === "create" ? request.env[DELEGATION_ENV] : undefined;
    if (id) tracker.bind(id, request.agentId);
    return undefined;
  });

  const removeCreated = server.on("agent.created", async (event, context) => {
    const entry = tracker.take(event.agent.id);
    if (!entry) return;
    await context.paseo.agents.ref(event.agent.id).timeline.append({
      type: "plugin",
      id: `delegation-${event.agent.id}`,
      kind: DELEGATION_TIMELINE_KIND,
      version: DELEGATION_TIMELINE_VERSION,
      data: entry.card,
    });
    await logDelegatedSession({ agentId: event.agent.id, cwd: event.agent.cwd, entry }).catch(
      (error: unknown) => console.error("[delegation] could not log the session", error),
    );
  });

  return () => {
    removeCreate();
    removeOpen();
    removeCreated();
  };
}
