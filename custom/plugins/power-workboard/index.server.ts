import { defineSettings } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { builtinPipelinesView } from "./shared/factory/builtin-pipelines"; // CUSTOM(factory)
import { DATA_SCHEMA_VERSION, dataSchema } from "./shared/model";
import {
  migrateData,
  InvalidStorageDataError,
  UNSUPPORTED_STORAGE_VERSION_ERROR_CODE,
  UnsupportedStorageVersionError,
} from "./shared/migrations";
import {
  mutateRpc,
  packageRunsRpc,
  readImageRpc,
  saveImageRpc,
  snapshotRpc,
  projectAccentsRpc, // CUSTOM(project-icon-colors)
  projectIconsRpc, // CUSTOM(project-icon-colors)
  deskStatusRpc,
  writeTicketRpc,
  redeployPaseoRpc,
  factoryPipelinesRpc, // CUSTOM(factory)
  factoryStatusRpc, // CUSTOM(factory)
} from "./shared/rpc";
// CUSTOM(projects-assistant)
import {
  assistantAskRpc,
  assistantQuickGetRpc,
  assistantQuickListRpc,
  assistantActionRpc,
  assistantChatOpenRpc,
  assistantConversationRpc,
  assistantHistoryRpc,
  assistantOverviewRpc,
  assistantSettingsGetRpc,
  assistantSettingsSetRpc,
  assistantStatsRpc,
  assistantTreeRpc,
  assistantReportsTaskRpc,
  assistantReportsTasksRpc,
  assistantPmCardsRpc, // CUSTOM(pm-board)
  assistantPmDecideRpc,
  assistantPmReopenRpc,
  assistantTaskStatesRpc, // CUSTOM(pm-chat-task-sync)
} from "./shared/assistant-rpc";
import {
  decidePmCardOnBoard,
  reopenPmCardOnBoard,
} from "./server/assistant/pm-board"; // CUSTOM(pm-board)
import {
  HistoryStore,
  defaultHistoryDirectory,
} from "./server/assistant/history";
import {
  attachChatTools,
  boardReportTool,
  chatTools,
  quickAckTool,
} from "./server/assistant/chat";
// CUSTOM(assistant-reports)
import {
  ReportStore,
  buildReportColumns,
  buildReportTasks,
  buildReportTimeline,
  defaultReportsDirectory,
} from "./server/assistant/reports";
import { QuickInbox } from "./server/assistant/quick"; // CUSTOM(assistant-quick)
import {
  buildOverview,
  buildStats,
  buildTree,
  readConversation,
} from "./server/assistant/views";
// CUSTOM(agent-profiles)
import {
  profilesGetRpc,
  profilesSetSystemPromptRpc,
  profilesSkillsRpc,
} from "./shared/profiles";
import { redeployPaseo } from "./server/redeploy"; // CUSTOM(redeploy-button)
// CUSTOM(factory)
import {
  defaultFactoryRoot,
  factoryStoreView,
  FactoryShadow,
} from "./server/factory/shadow";
import { factoryPipelinesView } from "./shared/factory/active";
import { defaultProfilesDirectory } from "./server/profiles";
import { ImageStore, defaultImageDirectory } from "./server/images";
import { PaseoCompat } from "./server/paseo-compat";
import { PaseoHost } from "./server/host";
import { Store } from "./server/store";
import { Workboard } from "./server/workboard";

export function classifyBootFailure(failure: unknown): {
  deterministic: boolean;
  error: string;
} {
  const deterministic =
    failure instanceof UnsupportedStorageVersionError ||
    failure instanceof InvalidStorageDataError;
  return {
    deterministic,
    error: failure instanceof Error ? failure.message : String(failure),
  };
}

export default function contribute(server: PluginServerContext) {
  const compat = new PaseoCompat();
  const bootstrap = compat.installBootstrap(server);
  const settings = server.registerSettings(
    defineSettings({
      id: "workboard-data",
      version: DATA_SCHEMA_VERSION,
      scope: "host",
      schema: dataSchema,
      migrate: migrateData,
    }),
  );
  const store = new Store({
    read: async () => {
      const result = await settings.read();
      if (result.status === "invalid") {
        if (result.error.includes(UNSUPPORTED_STORAGE_VERSION_ERROR_CODE))
          throw new UnsupportedStorageVersionError();
        throw new InvalidStorageDataError();
      }
      const version =
        result.values &&
        typeof result.values === "object" &&
        "schemaVersion" in result.values
          ? result.values.schemaVersion
          : undefined;
      if (typeof version === "number" && version !== DATA_SCHEMA_VERSION)
        throw new UnsupportedStorageVersionError();
      if (!dataSchema.safeParse(result.values).success)
        throw new InvalidStorageDataError();
      return result;
    },
    write: (revision, values) =>
      compat.invoke("settings.workboard-data.write", { revision, values }),
  });
  // CUSTOM(projects-assistant): created once; the board gets it on every (re)boot.
  const history = new HistoryStore(defaultHistoryDirectory());
  void history.prune().catch(() => undefined);
  // CUSTOM(assistant-reports): the assistant's report entries, kept as long as the history.
  const reports = new ReportStore(defaultReportsDirectory());
  void reports.prune().catch(() => undefined);
  // CUSTOM(assistant-quick): outside `boot`, so it survives board reboots.
  let serverId: string | null = null;
  const inbox = new QuickInbox({
    openChat: async () => (await ready().openChat(false)).agentId,
    send: (id, text) => ready().chatSend(id, text),
    activity: (id) => ready().chatActivity(id),
    lastReply: (id) => ready().chatLastReply(id),
    serverId: () => serverId,
    // CUSTOM(assistant-wake): a quick message carries the current Needs you list.
    needsYou: () => ready().assistantNeedsYouBrief(),
    // The chat's turn can start before the send resolves; keep it from steering the same list.
    sending: (ids) => ready().markAssistantSending(ids),
    markTold: (ids) => {
      try {
        void ready()
          .markAssistantTold(ids)
          .catch(() => undefined);
      } catch {
        // The board is not up; the next wake tells it again.
      }
    },
  });
  let board: Workboard | undefined;
  // CUSTOM(factory): the factory reads the board's saved data and projects. Shadow mode applies
  // nothing; active mode puts the compiled factory into every read of the store and keeps the
  // JSON's own config on every write (docs/factory.md, "Active mode").
  const factory = new FactoryShadow({
    live: () =>
      board
        ? {
            settings: () =>
              store.peek((data) => data.assistant.settings.factory),
            revision: () => store.peek((data) => data.revision),
            data: () => store.peek((data) => structuredClone(data)),
            projects: () => board?.inventoryProjects() ?? [],
          }
        : null,
    defaultRoot: defaultFactoryRoot(),
    profilesRoot: defaultProfilesDirectory(),
    applied: () => void board?.factoryChanged().catch(() => undefined),
  });
  store.setView(factoryStoreView(factory));
  let disposed = false;
  let error = "Workboard is starting";
  let retry: ReturnType<typeof setTimeout> | undefined;
  const stopChange = compat.onChange((type, payload) => {
    if (type === "disconnected") board?.disconnected();
    else if (typeof payload?.agentId === "string")
      board?.agentChanged(payload.agentId);
    else
      board?.changed(
        typeof payload?.workspaceId === "string"
          ? payload.workspaceId
          : undefined,
      );
  });
  const boot = async () => {
    try {
      const api = await bootstrap();
      if (disposed) return;
      const identity = await compat.identity();
      serverId = identity.serverId; // CUSTOM(assistant-quick)
      board?.dispose();
      const host = new PaseoHost(api, compat, identity, (id, agentId) => {
        if (agentId) board?.agentUpdated(agentId); // CUSTOM(assistant-compact)
        board?.changed(id);
      });
      // CUSTOM(projects-assistant), CUSTOM(assistant-compact): the chat waits for quick messages.
      board = new Workboard(host, store, Date.now, 60000, {
        history,
        chatQueued: (agentId) => inbox.pending(agentId),
        factory, // CUSTOM(factory)
      });
      await board.start();
      factory.sync(); // CUSTOM(factory)
    } catch (failure) {
      const classified = classifyBootFailure(failure);
      error = classified.error;
      board?.disconnected(error);
      if (classified.deterministic) {
        stopChange();
        board?.dispose();
      }
      console.error(
        "Workboard startup failed:",
        failure instanceof Error ? failure.message : String(failure),
      );
      if (!disposed && !classified.deterministic)
        retry = setTimeout(() => {
          void boot();
        }, 10000);
    }
  };
  server.handle(snapshotRpc, () => {
    if (!board) throw new Error(error);
    // CUSTOM(resource-pools): the board polls every 1.5 s, so a pool's RAM hold shows the RAM
    // read at the previous poll instead of the last pass's.
    void board.readPoolMemory().catch(() => undefined);
    return { ...board.snapshot(), factory: factory.summary() }; // CUSTOM(factory)
  });
  // CUSTOM(factory): mode, root, revision, errors, warnings and the diff of shadow mode.
  server.handle(factoryStatusRpc, () => {
    if (!board) throw new Error(error);
    return factory.status();
  });
  // CUSTOM(workboard-chip-status): the Desk header chip's counts.
  server.handle(deskStatusRpc, () => {
    if (!board) throw new Error(error);
    return board.deskStatus();
  });
  server.handle(projectAccentsRpc, () => {
    if (!board) throw new Error(error);
    return board.projectAccents();
  });
  server.handle(projectIconsRpc, () => {
    if (!board) throw new Error(error);
    return board.projectIcons();
  });
  server.handle(redeployPaseoRpc, () => redeployPaseo()); // CUSTOM(redeploy-button)
  server.handle(mutateRpc, (input) => {
    if (!board) throw new Error(error);
    return board.mutate(input);
  });
  // CUSTOM(packages): the gate history of one package.
  server.handle(packageRunsRpc, (input) => {
    if (!board) throw new Error(error);
    return { runs: board.packageRuns(input.packageId) };
  });
  server.handle(writeTicketRpc, async (input) => {
    if (!board) throw new Error(error);
    await board.writeTicket(input.agentId, input.focus);
    return { ok: true as const };
  });
  // CUSTOM(projects-assistant): the Project Manager's settings, views and actions.
  const ready = () => {
    if (!board) throw new Error(error);
    return board;
  };
  server.handle(assistantSettingsGetRpc, () => ready().assistantSettings());
  server.handle(assistantSettingsSetRpc, async (input) => {
    // CUSTOM(factory): the board syncs the factory before it answers, so a new mode or folder
    // applies now and leaving active mode answers with the JSON's values.
    return ready().setAssistantSettings(input.settings);
  });
  // CUSTOM(factory): the Pipelines tab, read only.
  server.handle(factoryPipelinesRpc, () => {
    const applied = factory.applied();
    return applied
      ? factoryPipelinesView(applied)
      : builtinPipelinesView(ready().assistantSettings().settings.reviews);
  });
  server.handle(assistantOverviewRpc, () =>
    buildOverview(ready().assistantSource()),
  );
  server.handle(assistantStatsRpc, async (input) => {
    const source = ready().assistantSource();
    const from = new Date(source.now);
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (input.days - 1));
    return buildStats(
      source,
      await history.since(from.toISOString()),
      input.days,
    );
  });
  server.handle(assistantHistoryRpc, (input) => history.list(input));
  server.handle(assistantTreeRpc, () => buildTree(ready().assistantSource()));
  server.handle(assistantConversationRpc, (input) => {
    const current = ready();
    return readConversation(
      current.assistantSource(),
      input.agentId,
      current.assistantTimeline(input.agentId),
      { before: input.before, limit: input.limit },
    );
  });
  server.handle(assistantActionRpc, async (input) => {
    await ready().assistantAction(input);
    return { ok: true as const };
  });
  server.handle(assistantChatOpenRpc, (input) =>
    ready().openChat(input.fresh, input.archivePrevious),
  );
  // CUSTOM(assistant-quick)
  server.handle(assistantAskRpc, (input) => inbox.ask(input));
  server.handle(assistantQuickGetRpc, (input) =>
    inbox.get(input.id, input.waitMs),
  );
  server.handle(assistantQuickListRpc, () => ({ items: inbox.list() }));
  // CUSTOM(assistant-reports): the Projects Reports page.
  server.handle(assistantReportsTasksRpc, async () => {
    const source = ready().assistantSource();
    const [events, entries] = await Promise.all([
      history.since(null),
      reports.since(null),
    ]);
    return {
      tasks: buildReportTasks(source, events, entries),
      columns: buildReportColumns(source),
    };
  });
  server.handle(assistantReportsTaskRpc, async (input) => {
    const source = ready().assistantSource();
    const mine = (value: { taskId: string }) => value.taskId === input.taskId;
    const [events, entries] = await Promise.all([
      history.since(null, mine),
      reports.since(null, mine),
    ]);
    return {
      timeline: buildReportTimeline(source, input.taskId, events, entries),
    };
  });
  // CUSTOM(pm-board): the Project Manager's own board. A user's answer and a reopen also reach the
  // PM chat as a message, so it can act on what the user decided.
  server.handle(assistantPmCardsRpc, () => {
    const board = ready();
    return {
      cards: board.pmCards(),
      taskNumbers: board.pmTaskNumbers(),
      packages: board.pmPackages(), // CUSTOM(packages)
      taskPackages: board.pmTaskPackages(),
    };
  });
  const pmMessage = async (text: string): Promise<string | null> => {
    try {
      const ack = await inbox.ask({ text, source: "pm-board", waitMs: 0 });
      // The inbox reports a failed send as an `error` ack with an id, not a throw.
      return ack.status === "error" ? null : ack.id;
    } catch {
      return null;
    }
  };
  server.handle(assistantPmDecideRpc, (input) =>
    decidePmCardOnBoard(ready(), pmMessage, input),
  );
  server.handle(assistantPmReopenRpc, (input) =>
    reopenPmCardOnBoard(ready(), pmMessage, input.cardId),
  );
  // CUSTOM(pm-chat-task-sync): the tasks a chat reply's `seu` line cites.
  server.handle(assistantTaskStatesRpc, (input) => ({
    tasks: ready().replyTaskStates(input.ids),
  }));
  // CUSTOM(agent-profiles): the profile of an orchestrator or of the assistant chat.
  server.handle(profilesGetRpc, (input) => ready().profileView(input.profile));
  server.handle(profilesSetSystemPromptRpc, async (input) => {
    await ready().setProfilePrompt(input.profile, input.text);
    return { ok: true as const };
  });
  server.handle(profilesSkillsRpc, async (input) => ({
    skills: await ready().profileSkills(input.profile),
  }));
  // The chat agent gets the board tools on every session open (create and resume).
  const boardTools = [
    ...chatTools(ready, history),
    quickAckTool(inbox), // CUSTOM(assistant-quick)
    boardReportTool(ready, reports, inbox), // CUSTOM(assistant-reports)
  ];
  const removeChatTools = server.before("agent.session_open", ({ request }) =>
    attachChatTools(request, boardTools),
  );
  // CUSTOM(assistant-wake): a user message gets the Needs you list steered in, and a deferred
  // plugin reload runs once the chat's turn ends.
  const removeChatTurns = [
    server.on("agent.turn_started", ({ agent }) =>
      board?.chatTurnStarted(agent.id),
    ),
    server.on("agent.turn_ended", ({ agent }) =>
      board?.chatTurnEnded(agent.id),
    ),
  ];
  // CUSTOM(workboard-images): independent of the board, so images work while it boots.
  const images = new ImageStore(defaultImageDirectory());
  server.handle(saveImageRpc, (input) => images.save(input));
  server.handle(readImageRpc, (input) => images.read(input));
  // The host must mark this contribution ready before it can dispatch the bootstrap self-RPC.
  const immediate = setImmediate(() => {
    void boot();
  });
  return () => {
    disposed = true;
    clearImmediate(immediate);
    clearTimeout(retry);
    stopChange();
    removeChatTools(); // CUSTOM(projects-assistant)
    for (const off of removeChatTurns) off(); // CUSTOM(assistant-wake)
    inbox.dispose(); // CUSTOM(assistant-quick)
    board?.dispose();
    factory.dispose(); // CUSTOM(factory)
    compat.dispose();
  };
}
