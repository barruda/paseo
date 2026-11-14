import { expect, test } from "vitest";
import { createPaseoApi } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { PluginHookHandlers } from "./index.js";

const paseo = createPaseoApi(
  new DaemonClient({ url: "ws://127.0.0.1:1/ws", clientId: "lifecycle-unit" }),
);

test("removing an old registration twice preserves a newer registration for the same hook", async () => {
  const hooks = new PluginHookHandlers(() => {});
  const remove = hooks.before("workspace.create", ({ request }) => {
    return { ...request, title: "old" };
  });
  remove();
  hooks.before("workspace.create", ({ request }) => {
    return { ...request, title: "new" };
  });
  remove();
  const output = await hooks.invoke(
    "operation",
    "before",
    "workspace.create",
    {
      source: { kind: "directory", path: "/project" },
    },
    paseo,
  );
  expect(output).toEqual({ source: { kind: "directory", path: "/project" }, title: "new" });
});

test("before hooks compose returned requests and preserve the original input", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("workspace.create", ({ request }) => {
    return { ...request, title: "first" };
  });
  hooks.before("workspace.create", () => {
    return;
  });
  hooks.before("workspace.create", ({ request }) => {
    return { ...request, title: request.title + ":second" };
  });
  const input = { source: { kind: "directory", path: "/project" } };
  expect(await hooks.invoke("operation", "before", "workspace.create", input, paseo)).toEqual({
    source: { kind: "directory", path: "/project" },
    title: "first:second",
  });
  expect(input).toEqual({ source: { kind: "directory", path: "/project" } });
});

test("teardown aborts an active callback and removes its registrations", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("workspace.create", async (_input, context) => {
    await new Promise<void>((_resolve, reject) => {
      context.signal.addEventListener(
        "abort",
        () => {
          reject(new Error("Hook aborted"));
        },
        { once: true },
      );
    });
  });
  const invocation = hooks.invoke(
    "operation",
    "before",
    "workspace.create",
    {
      source: { kind: "directory", path: "/project" },
    },
    paseo,
  );
  hooks.close();
  await expect(invocation).rejects.toThrow("Hook aborted");
  expect(hooks.catalog()).toEqual({ events: [], before: [] });
});

test("session-open hooks reject changes to session identity instead of silently ignoring them", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("agent.session_open", ({ request }) => {
    return { ...request, provider: "another-provider" };
  });
  await expect(
    hooks.invoke(
      "operation",
      "before",
      "agent.session_open",
      {
        agentId: "agent",
        workspaceId: "workspace",
        provider: "claude",
        cwd: "/project",
        reason: "resume",
        purpose: "interactive",
        env: {},
        title: null,
        labels: {},
        tools: [],
        mcpServers: {},
      },
      paseo,
    ),
  ).rejects.toThrow("agent.session_open hooks can only change env");
});

test.each([{ title: "Changed" }, { labels: { changed: "true" } }])(
  "session-open targeting metadata is read-only: %j",
  async (patch) => {
    const hooks = new PluginHookHandlers(() => {});
    hooks.before("agent.session_open", ({ request }) => ({ ...request, ...patch }));
    await expect(
      hooks.invoke(
        "operation",
        "before",
        "agent.session_open",
        {
          agentId: "agent",
          workspaceId: null,
          provider: "codex",
          cwd: "/project",
          title: "Original",
          labels: {},
          tools: [],
          mcpServers: {},
          env: {},
          reason: "create",
          purpose: "interactive",
        },
        paseo,
      ),
    ).rejects.toThrow("agent.session_open hooks can only change env, tools, and mcpServers");
  },
);

// CUSTOM(delegation-paseo-runner): agent.create hooks see the new agent's labels, read-only.
test("agent.create hooks see the labels and cannot change them", async () => {
  const hooks = new PluginHookHandlers(() => {});
  const seen: unknown[] = [];
  hooks.before("agent.create", ({ request }) => {
    seen.push(request.labels);
    return { ...request, env: { A: "1" } };
  });
  const input = {
    config: { provider: "claude", cwd: "/project" },
    labels: { "paseo.parent-agent-id": "p1" },
  };
  const output = await hooks.invoke("operation", "before", "agent.create", input, paseo);
  expect(seen).toEqual([{ "paseo.parent-agent-id": "p1" }]);
  expect(output).toMatchObject({ labels: input.labels, env: { A: "1" } });

  const tampering = new PluginHookHandlers(() => {});
  tampering.before("agent.create", ({ request }) => ({ ...request, labels: {} }));
  await expect(
    tampering.invoke("operation", "before", "agent.create", input, paseo),
  ).rejects.toThrow(/labels/);

  const dropping = new PluginHookHandlers(() => {});
  dropping.before("agent.create", ({ request }) => ({ config: request.config, env: request.env }));
  await expect(
    dropping.invoke("operation", "before", "agent.create", input, paseo),
  ).resolves.toBeDefined();
});
