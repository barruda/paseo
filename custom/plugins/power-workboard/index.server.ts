import { defineSettings } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { DATA_SCHEMA_VERSION, dataSchema } from "./shared/model";
import {
  migrateData,
  InvalidStorageDataError,
  UNSUPPORTED_STORAGE_VERSION_ERROR_CODE,
  UnsupportedStorageVersionError,
} from "./shared/migrations";
import {
  mutateRpc,
  readImageRpc,
  saveImageRpc,
  snapshotRpc,
  writeTicketRpc,
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
} from "./shared/assistant-rpc";
import {
  HistoryStore,
  defaultHistoryDirectory,
} from "./server/assistant/history";
import {
  attachChatTools,
  chatTools,
  quickAckTool,
} from "./server/assistant/chat";
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
  // CUSTOM(assistant-quick): outside `boot`, so it survives board reboots.
  let serverId: string | null = null;
  const inbox = new QuickInbox({
    openChat: async () => (await ready().openChat(false)).agentId,
    send: (id, text) => ready().chatSend(id, text),
    activity: (id) => ready().chatActivity(id),
    lastReply: (id) => ready().chatLastReply(id),
    serverId: () => serverId,
  });
  let board: Workboard | undefined;
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
      const host = new PaseoHost(api, compat, identity, (id) =>
        board?.changed(id),
      );
      board = new Workboard(host, store, Date.now, 60000, { history }); // CUSTOM(projects-assistant)
      await board.start();
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
    return board.snapshot();
  });
  server.handle(mutateRpc, (input) => {
    if (!board) throw new Error(error);
    return board.mutate(input);
  });
  server.handle(writeTicketRpc, async (input) => {
    if (!board) throw new Error(error);
    await board.writeTicket(input.agentId, input.focus);
    return { ok: true as const };
  });
  // CUSTOM(projects-assistant): the Projects Assistant's settings, views and actions.
  const ready = () => {
    if (!board) throw new Error(error);
    return board;
  };
  server.handle(assistantSettingsGetRpc, () => ready().assistantSettings());
  server.handle(assistantSettingsSetRpc, (input) =>
    ready().setAssistantSettings(input.settings),
  );
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
  const boardTools = [...chatTools(ready, history), quickAckTool(inbox)]; // CUSTOM(assistant-quick)
  const removeChatTools = server.before("agent.session_open", ({ request }) =>
    attachChatTools(request, boardTools),
  );
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
    inbox.dispose(); // CUSTOM(assistant-quick)
    board?.dispose();
    compat.dispose();
  };
}
