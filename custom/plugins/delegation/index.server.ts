import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { PluginServerContext, PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import {
  type DelegationSettings,
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
import { sessionOpenEnv } from "./server/session-open-env";
import {
  CLAUDE_MD_EXCLUDES_ENV,
  CODEX_AGENTS_MD_ENV,
  buildClaudeMdExcludes,
} from "./server/claude-md-excludes";
import { delegationSettings, reportRpc } from "./shared/settings";
import { buildReport } from "./server/report";
import { logDelegatedSession } from "./server/session-log";
import { DelegationTracker } from "./server/tracker";

// Same name as `SUBAGENT_APPEND_PROMPT_ENV` in the daemon (agent/subagent-append-prompt.ts).
const SUBAGENT_APPEND_PROMPT_ENV = "PASEO_SUBAGENT_APPEND_PROMPT";

const execFileAsync = promisify(execFile);

async function findProjectRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim() || cwd;
  } catch {
    return cwd;
  }
}

// While delegation is on, a new Claude session on Opus or Fable gets the rule in its saved system
// prompt (so it survives resumes and keeps the prompt cache), and a card at the top of its chat.
// Sessions already open, other providers and cheaper models are left alone. Daemon-internal agents
// never reach these hooks.
export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(delegationSettings);
  const tracker = new DelegationTracker();

  // The sheet's Reports tab.
  server.handle(reportRpc, (input) => buildReport({ days: input.days }));

  const removeCreate = server.before("agent.create", async ({ request }) => {
    // CUSTOM(delegation-paseo-runner): a Paseo subagent (delegated or not) never gets the rule.
    if (request.labels?.[PARENT_AGENT_ID_LABEL]) return undefined;
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

  // Runs on every launch (create and resume). Binds the tracker. Every Claude session also gets
  // the agent definitions and the subagent cache TTL, delegation on or off: a session created while
  // delegation was on keeps the rule in its system prompt across resumes. A Paseo-created subagent
  // also gets its instructions and the trimmed CLAUDE.md files (the "Subagent context" setting),
  // whether or not delegation itself is on.
  const removeOpen = server.before("agent.session_open", async ({ request }) => {
    const id = request.reason === "create" ? request.env[DELEGATION_ENV] : undefined;
    if (id) tracker.bind(id, request.agentId);
    const isSubagent = Boolean(request.labels[PARENT_AGENT_ID_LABEL]);
    if (!isSubagent && request.provider !== "claude") return undefined;
    const state = await settings.read();
    if (state.status !== "ready") return undefined;
    const added = {
      ...sessionOpenEnv({ provider: request.provider, isSubagent, values: state.values }),
      ...(isSubagent ? await subagentEnv(request, state.values) : {}),
    };
    if (Object.keys(added).length === 0) return undefined;
    return { ...request, env: { ...request.env, ...added } };
  });

  // What a Paseo-created subagent gets on top: instructions (any provider) and a smaller context.
  async function subagentEnv(
    request: PluginSessionOpenRequest,
    values: DelegationSettings,
  ): Promise<Record<string, string>> {
    const env: Record<string, string> = {};
    // Any provider: the daemon folds this into the launch config's appended system prompt.
    const instructions = values.subagentInstructions.trim();
    if (instructions) env[SUBAGENT_APPEND_PROMPT_ENV] = instructions;
    const mode = values.subagentContext;
    if (request.provider === "codex") {
      // Codex can drop the repo's AGENTS.md but not the global one, so `project` changes nothing.
      if (mode === "none") env[CODEX_AGENTS_MD_ENV] = "none";
    } else if (request.provider === "claude") {
      if (mode === "none") env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
      if (mode === "project") {
        const excludes = buildClaudeMdExcludes({
          projectRoot: await findProjectRoot(request.cwd),
          configDir:
            request.env.CLAUDE_CONFIG_DIR ??
            process.env.CLAUDE_CONFIG_DIR ??
            path.join(os.homedir(), ".claude"),
        });
        env[CLAUDE_MD_EXCLUDES_ENV] = JSON.stringify(excludes);
      }
    }
    return env;
  }

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
