import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
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
import {
  CLAUDE_MD_EXCLUDES_ENV,
  CODEX_AGENTS_MD_ENV,
  buildClaudeMdExcludes,
} from "./shared/claude-md-excludes";
import { delegationSettings, reportRpc } from "./shared/settings";
import { buildReport } from "./server/report";
import { logDelegatedSession } from "./server/session-log";
import { DelegationTracker } from "./server/tracker";

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

  // Runs on every launch (create and resume). Binds the tracker, and trims the CLAUDE.md files a
  // Paseo-created Claude subagent loads (the "Subagent context" setting), whether or not
  // delegation itself is on.
  const removeOpen = server.before("agent.session_open", async ({ request }) => {
    const id = request.reason === "create" ? request.env[DELEGATION_ENV] : undefined;
    if (id) tracker.bind(id, request.agentId);
    if (!request.labels[PARENT_AGENT_ID_LABEL]) return undefined;
    if (request.provider !== "claude" && request.provider !== "codex") return undefined;
    const state = await settings.read();
    if (state.status !== "ready") return undefined;
    const mode = state.values.subagentContext;
    if (request.provider === "codex") {
      // Codex can drop the repo's AGENTS.md but not the global one, so `project` changes nothing.
      return mode === "none"
        ? { ...request, env: { ...request.env, [CODEX_AGENTS_MD_ENV]: "none" } }
        : undefined;
    }
    if (mode === "none") {
      return { ...request, env: { ...request.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" } };
    }
    if (mode === "project") {
      const excludes = buildClaudeMdExcludes({
        projectRoot: await findProjectRoot(request.cwd),
        configDir:
          request.env.CLAUDE_CONFIG_DIR ??
          process.env.CLAUDE_CONFIG_DIR ??
          path.join(os.homedir(), ".claude"),
      });
      return {
        ...request,
        env: { ...request.env, [CLAUDE_MD_EXCLUDES_ENV]: JSON.stringify(excludes) },
      };
    }
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
