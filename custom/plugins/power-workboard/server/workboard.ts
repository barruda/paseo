import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  archiveDueAt,
  archiveGate,
  cardsForStage,
  conversationStatusFor,
  defaultGroup,
  defaultWorkspaceGroup,
  defaultStartWorkGroup,
  groupKind,
  isArchiveDue,
  isDraftGroup,
  isTerminalGroup,
  labelKey,
  orchestratorConfigSchema,
  orchestratorSchema,
  newTask,
  orderedGroups,
  resolveStage,
  settingsSchema,
  statusLabels,
  DEFAULT_GROUPS,
  STAGE_COLORS,
  type Board,
  type Card,
  type Data,
  type Orchestration,
  type OrchestratorConfig,
  type OrchestratorRuntime,
  ORCHESTRATOR_LOG_LIMIT,
  type Refinement,
  type ConversationAgent,
  type ConversationDisplay,
  type ConversationGate,
  type ConversationReason,
  type Settings,
  type Stage,
  type Task,
} from "../shared/model";
import { dueTrigger, nextRunAt, windowOpen } from "../shared/schedule";
import { CANCEL_BINDING_BUSY_ERROR_CODE, type Mutation } from "../shared/rpc";
import {
  continuationPrompt,
  orchestratorPrompt,
  parseTicket,
  refinementPrompt,
  writeTicketPrompt,
} from "./orchestrator";
import type {
  Agent,
  ConversationEvidence,
  Host,
  Inventory,
  Workspace,
} from "./host";
import type { Store } from "./store";

/** One workspace's combined conversation evidence. */
interface WorkspaceConversation {
  displayAt: string | null;
  display: ConversationDisplay;
  gateAt: string | null;
  gate: ConversationGate;
  reason: ConversationReason | null;
  agents: ConversationAgent[];
}
/** Most severe first, so one reason is stored per task. */
const REASON_ORDER: ConversationReason[] = [
  "timeline-unreadable",
  "child-enumeration-unavailable",
  "child-timeline-unreadable",
  "replay-timestamp",
  "truncated-window",
];

const labelsEqual = (a: string[], b: string[]) =>
  JSON.stringify(a.map(labelKey).sort()) ===
  JSON.stringify(b.map(labelKey).sort());
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const sameOrder = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);
const hidden = (task: Task) =>
  task.archived?.status === "archived" || task.archived?.status === "external";

function projectChangeRequest(workspace?: Workspace): Card["changeRequest"] {
  const runtime = workspace?.githubRuntime;
  const request = runtime?.pullRequest;
  if (!request) return null;
  const nativeState = request.state.toLowerCase();
  const state =
    request.isMerged || nativeState === "merged"
      ? "merged"
      : nativeState === "closed"
        ? "closed"
        : nativeState === "open" || nativeState === "opened"
          ? request.isDraft
            ? "draft"
            : "open"
          : "unknown";
  return {
    forge: workspace?.forge ?? "github",
    number: request.number ?? null,
    url: request.url,
    title: request.title,
    state,
    checksStatus: request.checksStatus ?? null,
    reviewDecision: request.reviewDecision ?? null,
  };
}

/** One writer per plugin process. UI windows never own timers or archive operations. */
export class Workboard {
  private inventory: Inventory = { workspaces: [], agents: [], projects: [] };
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<void> | undefined;
  // null means a full refresh; undefined means no work is waiting.
  private pendingRefresh: Set<string> | null | undefined;
  private stopped = false;
  private pendingMutations = 0;
  private connectionGeneration = 0;
  private epoch = 0;
  private workspaceEpochs = new Map<string, number>();
  private bindingInFlight = new Set<string>();
  private queuedStarts = new Map<string, number>();
  private archiveDeferrals = new Map<
    string,
    {
      reason: string;
      attempts: number;
      deferredUntil: number;
      fingerprint: string;
    }
  >();
  private connected = false;
  private error: string | null = "Workboard is starting";
  private refreshedAt: string | null = null;
  constructor(
    private host: Host,
    private store: Store,
    private now: () => number = Date.now,
    private interval = 60000,
  ) {}
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const work = this.queue.then(() => {
      if (this.stopped) throw new Error("Workboard stopped");
      return run();
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  private stamp(previous?: string): string {
    return new Date(
      Math.max(this.now(), previous ? Date.parse(previous) + 1 : 0),
    ).toISOString();
  }
  /** Only workspaces registered on this board are observed; the rest of the host is ignored. */
  private trackedWorkspaces(): Set<string> {
    const ids = new Set<string>();
    for (const task of this.store.current.tasks) {
      if (task.workspaceId) ids.add(task.workspaceId);
      if (task.binding?.workspaceId) ids.add(task.binding.workspaceId);
    }
    return ids;
  }
  private inventoryNow(): Promise<Inventory> {
    return this.host.inventory(this.trackedWorkspaces());
  }
  private task(id: string): Task {
    const task = this.store.current.tasks.find((t) => t.id === id);
    if (!task) throw new Error("Task no longer exists");
    return task;
  }
  async start(): Promise<void> {
    await this.serial(async () => {
      await this.load();
      await this.store.update((data) => {
        for (const task of data.tasks)
          if (task.archived?.status === "pending") {
            task.archived.status = "uncertain";
            task.archived.detail =
              "Native archive outcome unknown after restart";
            task.issue = "native-archive-unknown";
          }
      });
      const bindings = this.store.current.tasks.filter((t) => t.binding);
      for (const task of bindings)
        this.bindingInFlight.add(task.binding!.operationId);
      for (const task of bindings) {
        try {
          await this.bind(task.id);
        } catch {
          await this.issue(task.id, "label-sync-incomplete");
        }
      }
      for (const task of bindings)
        this.bindingInFlight.delete(task.binding!.operationId);
      await this.reconcile();
      await this.scan();
      await this.orchestrate();
    });
    if (!this.stopped)
      this.timer = setInterval(() => {
        void this.refresh().catch(() => undefined);
      }, this.interval);
  }
  private async load() {
    await this.store.load();
    const serverId = this.store.current.serverId;
    if (serverId && serverId !== this.host.identity.serverId)
      throw new Error("Workboard storage belongs to another Paseo host");
    if (!serverId)
      await this.store.update((data) => {
        data.serverId = this.host.identity.serverId;
      });
    // Boards saved before Ready to start existed get it right after their first To do group.
    const ready = DEFAULT_GROUPS.find((group) => group.kind === "ready")!;
    const groups = this.store.current.settings.groups;
    if (
      !groups.some((group) => group.kind === "ready") &&
      !groups.some(
        (group) =>
          group.id === ready.id ||
          labelKey(group.label) === labelKey(ready.label),
      )
    )
      await this.store.update((data) => {
        const settings = data.settings;
        const ordered = orderedGroups(settings).map((group) => group.id);
        const after = orderedGroups(settings).findIndex(
          (group) => group.kind === "todo",
        );
        settings.groups.push({ ...ready });
        if (settings.groupOrder.length) {
          ordered.splice(after + 1, 0, ready.id);
          settings.groupOrder = ordered;
        } else {
          settings.groupOrder = [
            ...ordered.slice(0, after + 1),
            ready.id,
            ...ordered.slice(after + 1),
          ];
        }
      });
  }
  refresh(): Promise<void> {
    this.pendingRefresh = null;
    return this.flushRefresh();
  }
  private flushRefresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.serial(async () => {
      const scope = this.pendingRefresh ?? undefined;
      this.pendingRefresh = undefined;
      try {
        if (!this.connected) await this.load();
        await this.reconcile(scope);
        await this.scan(scope);
        await this.orchestrate();
      } catch (error) {
        this.connected = false;
        this.error = message(error);
        throw error;
      }
    }).finally(() => {
      this.refreshing = undefined;
      if (this.pendingRefresh !== undefined) this.scheduleRefresh();
    });
    return this.refreshing;
  }
  private observation(id: string): string {
    return `${this.epoch}:${this.workspaceEpochs.get(id) ?? 0}`;
  }
  agentChanged(id: string): void {
    // Streams of agents outside the board must not force a full refresh.
    const workspaceId = this.inventory.agents.find(
      (a) => a.id === id,
    )?.workspaceId;
    if (workspaceId) this.changed(workspaceId);
  }
  changed(workspaceId?: string): void {
    if (workspaceId && !this.trackedWorkspaces().has(workspaceId)) return;
    if (workspaceId)
      this.workspaceEpochs.set(
        workspaceId,
        (this.workspaceEpochs.get(workspaceId) ?? 0) + 1,
      );
    else this.epoch++;
    if (!workspaceId) this.pendingRefresh = null;
    else if (this.pendingRefresh !== null) {
      this.pendingRefresh ??= new Set();
      this.pendingRefresh.add(workspaceId);
    }
    this.scheduleRefresh();
  }
  private scheduleRefresh(): void {
    if (this.stopped || this.debounce || this.refreshing) return;
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      if (this.pendingRefresh !== undefined)
        void this.flushRefresh().catch(() => undefined);
    }, 300);
  }
  disconnected(reason = "Paseo disconnected"): void {
    this.epoch++;
    this.connectionGeneration++;
    this.connected = false;
    this.error = reason;
  }
  snapshot(data: Data = this.store.current): Board {
    return {
      revision: data.revision,
      ...this.host.identity,
      connected: this.connected,
      error: this.error,
      refreshedAt: this.refreshedAt,
      settings: data.settings,
      cardOrderByStage: data.cardOrderByStage,
      orchestrator: data.orchestrator,
      orchestrations: data.orchestrations,
      refinements: data.refinements,
      orchestrators: data.orchestrators,
      orchestratorRuntime: data.orchestratorRuntime,
      orchestratorLogs: data.orchestratorLogs,
      orchestratorStatus: Object.fromEntries(
        data.orchestrators.map((o) => [o.id, this.orchestratorStatus(o, data)]),
      ),
      projects: this.inventory.projects,
      cards: data.tasks.map((task) => {
        const workspace = this.inventory.workspaces.find(
          (w) => w.id === task.workspaceId,
        );
        const agents = this.inventory.agents.filter(
          (a) => a.workspaceId === task.workspaceId,
        );
        const activities = agents
          .filter((a) => !a.archivedAt)
          .map((a) => a.activity);
        const activity: Card["activity"] =
          (["waiting", "error", "attention", "running"] as const).find((a) =>
            activities.includes(a),
          ) ?? "idle";
        const stage = task.workspaceId
          ? workspace
            ? resolveStage(
                workspace.labels,
                data.settings.groups,
                data.settings.defaultStartGroup,
              )
            : task.lastStage
          : task.draftStage;
        return {
          ...task,
          stage,
          labels: workspace?.labels ?? [],
          managedLabels: statusLabels(
            workspace?.labels ?? [],
            data.settings.groups,
          ),
          activity,
          changeRequest: projectChangeRequest(workspace),
          changeRequestUnavailable: !!workspace?.githubRuntime?.error,
          pinState:
            workspace?.pinnedAt == null
              ? "none"
              : data.autoPins[workspace.id] === workspace.pinnedAt
                ? "automatic"
                : "manual",
          dueAt:
            task.workspaceId && isTerminalGroup(stage, data.settings.groups)
              ? archiveDueAt(archiveGate(task), data.settings.archiveAfterDays)
              : null,
          agents: agents.map((a) => ({
            id: a.id,
            title: a.title ?? a.id,
            activity: a.activity,
            archived: !!a.archivedAt,
          })),
        };
      }),
    };
  }
  private async reconcile(scope?: ReadonlySet<string>): Promise<void> {
    const connection = this.connectionGeneration;
    const inventory = await this.inventoryNow();
    await this.syncPins(inventory, connection);
    const prior = this.store.current;
    const observations = new Map<string, WorkspaceConversation>();
    for (const workspace of inventory.workspaces) {
      const agents = inventory.agents.filter(
        (agent) => agent.workspaceId === workspace.id,
      );
      const previous = prior.tasks.find(
        (task) => task.workspaceId === workspace.id,
      );
      if (scope && !scope.has(workspace.id) && previous) continue;
      if (previous && this.archiveDeferred(previous, workspace, agents))
        continue;
      const evidence = await this.observe(agents, previous, this.now());
      if (previous && this.archiveDeferrals.has(previous.id)) {
        if (evidence.gate === "unknown")
          await this.deferArchive(
            previous,
            "conversation-unknown",
            workspace,
            agents,
          );
        else if (
          !isArchiveDue(
            groupKind(
              resolveStage(
                workspace.labels,
                prior.settings.groups,
                prior.settings.defaultStartGroup,
              ),
              prior.settings.groups,
            ),
            evidence.gateAt,
            this.now(),
            prior.settings.archiveAfterDays,
          )
        )
          this.archiveDeferrals.delete(previous.id);
      }
      observations.set(workspace.id, evidence);
    }
    if (this.stopped) throw new Error("Workboard stopped");
    this.inventory = inventory;
    await this.store.update((data) => {
      for (const workspace of inventory.workspaces) {
        // Workspaces are never imported: only a task created here links one.
        const task = data.tasks.find((t) => t.workspaceId === workspace.id);
        if (!task) continue;
        if (task.archived?.status === "external") task.archived = null;
        task.title = workspace.name;
        task.projectId = workspace.projectId;
        task.projectName = workspace.projectDisplayName;
        task.lastStage = resolveStage(
          workspace.labels,
          data.settings.groups,
          data.settings.defaultStartGroup,
        );
        const observation = observations.get(workspace.id);
        if (observation) {
          task.lastConversationAt = observation.displayAt;
          task.conversationDisplayEvidence = observation.display;
          task.conversationStatus = conversationStatusFor(observation.display);
          task.conversationGateAt = observation.gateAt;
          task.conversationGateEvidence = observation.gate;
          task.conversationReason = observation.reason;
          task.conversationAgents = observation.agents;
        }
        task.issue =
          task.archived?.status === "uncertain"
            ? "native-archive-unknown"
            : task.binding
              ? "label-sync-incomplete"
              : task.lastStage === "conflict"
                ? "labels-conflict"
                : task.conversationStatus === "unknown"
                  ? "conversation-unknown"
                  : task.conversationStatus === "none"
                    ? "no-conversation"
                    : (this.archiveDeferrals.get(task.id)?.reason ?? null);
      }
      for (const task of data.tasks) {
        if (
          task.workspaceId &&
          !inventory.workspaces.some((w) => w.id === task.workspaceId) &&
          !task.archived &&
          !task.binding &&
          task.issue !== "archive-restored-workspace-unavailable"
        ) {
          task.archived = {
            operationId: randomUUID(),
            kind: "external",
            status: "external",
            stage: task.lastStage,
            group:
              data.settings.groups.find(
                (group) => group.id === task.lastStage,
              ) ?? null,
            startedAt: this.stamp(),
            archivedAt: null,
            lastConversationAt: task.lastConversationAt,
            detail:
              "No longer in Paseo active workspaces; native archive time and cleanup unknown",
          };
        }
      }
    });
    if (connection !== this.connectionGeneration)
      throw new Error(this.error ?? "Paseo disconnected during refresh");
    this.connected = true;
    this.error = null;
    this.refreshedAt = this.stamp();
  }
  /**
   * Combine every agent's evidence into one display time and one archive gate. Only a full
   * exact read of every agent and every provider child can claim an exact time; anything
   * else keeps the newest observed bound so a task never loses its card time, while the gate
   * stays an upper bound that can only delay archiving.
   */
  private async observe(
    agents: readonly Agent[],
    previous: Task | undefined,
    now: number,
    options: { archivedTimeline?: boolean } = {},
  ): Promise<WorkspaceConversation> {
    const readings: Array<{
      agent: Agent;
      conversation: ConversationEvidence;
    }> = [];
    for (const agent of agents) {
      const isChild = Boolean(agent.parentAgentId && agent.subagentId);
      let conversation: ConversationEvidence;
      try {
        conversation = await this.host.conversation(agent, now, options);
      } catch {
        // One unreadable agent degrades its own evidence instead of the whole workspace.
        const bound = isChild ? null : (agent.updatedAt ?? null);
        conversation = {
          displayAt: bound,
          display: bound === null ? "unknown" : "upper-bound",
          gateAt: bound,
          gate: bound === null ? "unknown" : "upper-bound",
          reason: isChild ? "child-timeline-unreadable" : "timeline-unreadable",
        };
      }
      readings.push({ agent, conversation });
    }
    const reasons = new Set<ConversationReason>();
    let lower: number | null = null;
    let upper: number | null = null;
    for (const { agent, conversation } of readings) {
      if (conversation.reason) reasons.add(conversation.reason);
      if (
        agent.childEnumeration === "refused" ||
        agent.childEnumeration === "unavailable"
      )
        reasons.add("child-enumeration-unavailable");
      const time = conversation.displayAt
        ? Date.parse(conversation.displayAt)
        : null;
      if (time !== null) {
        // An upper-bound display value never counts as a lower bound of the conversation.
        if (conversation.display === "upper-bound")
          upper = Math.max(upper ?? time, time);
        else lower = Math.max(lower ?? time, time);
      }
      const isChild = Boolean(agent.parentAgentId && agent.subagentId);
      const activity = isChild ? null : Date.parse(agent.updatedAt);
      if (activity !== null && Number.isFinite(activity))
        upper = Math.max(upper ?? activity, activity);
    }
    const recorded = previous?.conversationAgents ?? [];
    const live = new Set(
      readings
        .filter(({ agent }) => agent.childEnumeration === "complete")
        .map(({ agent }) => agent.id),
    );
    const agentsEvidence: ConversationAgent[] = readings
      .filter(({ agent }) => Boolean(agent.parentAgentId && agent.subagentId))
      .map(({ agent, conversation }) => ({
        id: agent.id,
        lastObservedAt: conversation.displayAt,
        seenWhileLive: live.has(agent.parentAgentId!),
      }));
    const current = new Set(readings.map(({ agent }) => agent.id));
    let blocked = false;
    for (const entry of recorded) {
      if (current.has(entry.id)) continue;
      agentsEvidence.push(entry);
      // A vanished child cannot be re-read, so this workspace can no longer claim an exact
      // time. Its recorded observation still participates in both bounds; without one nothing
      // bounds its conversation any more.
      reasons.add("child-enumeration-unavailable");
      const time = entry.lastObservedAt
        ? Date.parse(entry.lastObservedAt)
        : null;
      if (time === null || !Number.isFinite(time)) {
        blocked = true;
        continue;
      }
      lower = Math.max(lower ?? time, time);
      upper = Math.max(upper ?? time, time);
    }
    if (lower !== null) upper = Math.max(upper ?? lower, lower);
    // Derived after the vanished children folded in: their reasons and their time decide whether
    // this workspace can claim an exact time or the absence of any conversation at all.
    const exact =
      readings.length > 0 &&
      reasons.size === 0 &&
      readings.every(({ conversation }) => conversation.gate === "exact");
    const noConversation =
      readings.length > 0 &&
      reasons.size === 0 &&
      readings.every(({ conversation }) => conversation.display === "none");
    const reason =
      REASON_ORDER.find((candidate) => reasons.has(candidate)) ?? null;
    const bounded =
      lower === null
        ? upper === null
          ? ({ display: "unknown", gate: "unknown" } as const)
          : ({ display: "upper-bound", gate: "upper-bound" } as const)
        : ({
            display: "lower-bound",
            gate: upper === null ? "unknown" : "upper-bound",
          } as const);
    const boundAt = lower ?? upper;
    const display: ConversationDisplay = exact
      ? "exact"
      : noConversation
        ? "none"
        : bounded.display;
    const gate: ConversationGate = exact
      ? "exact"
      : blocked || noConversation || upper === null
        ? "unknown"
        : "upper-bound";
    const gateAt =
      gate === "exact" ? boundAt : blocked || noConversation ? null : upper;
    return {
      displayAt:
        noConversation || boundAt === null
          ? null
          : new Date(boundAt).toISOString(),
      display,
      gateAt: gateAt === null ? null : new Date(gateAt).toISOString(),
      gate,
      reason: exact || noConversation ? null : reason,
      agents: agentsEvidence,
    };
  }
  /**
   * Re-read one candidate's conversation before archiving it. Returns the gate that the
   * archive decision may use, or null when no bound can be proven right now.
   */
  private async verifyConversation(
    candidate: Task,
    agents: readonly Agent[],
  ): Promise<string | null> {
    let gate: number | null = null;
    try {
      // The archive candidate is the one place that pays for an archived agent's timeline,
      // and a vanished child without a recorded time already forces an unknown gate.
      const evidence = await this.observe(agents, candidate, this.now(), {
        archivedTimeline: true,
      });
      const at = archiveGate({
        conversationGateAt: evidence.gateAt,
        conversationGateEvidence: evidence.gate,
      });
      if (at === null) return null;
      gate = Date.parse(at);
    } catch {
      return null;
    }
    return gate === null || !Number.isFinite(gate)
      ? null
      : new Date(gate).toISOString();
  }
  private async syncPins(
    inventory: Inventory,
    connection: number,
  ): Promise<void> {
    const connected = () =>
      !this.stopped && connection === this.connectionGeneration;
    const wantsPin = (workspace: Workspace) => {
      const settings = this.store.current.settings;
      return (
        settings.pinInProgressWorkspaces &&
        !workspace.archivingAt &&
        groupKind(
          resolveStage(
            workspace.labels,
            settings.groups,
            settings.defaultStartGroup,
          ),
          settings.groups,
        ) === "in-progress"
      );
    };
    for (const listed of inventory.workspaces) {
      if (!connected()) return;
      const id = listed.id;
      const owned = this.store.current.autoPins[id];
      if (owned === undefined && !wantsPin(listed)) continue;
      const observation = this.observation(id);
      const current = () => connected() && observation === this.observation(id);
      const workspace = await this.host.workspace(id);
      if (!workspace || !current()) continue;
      if (!wantsPin(workspace)) {
        if (owned && workspace.pinnedAt === owned)
          await this.host.setPinned(id, false);
        if (owned !== undefined)
          await this.store.update((data) => {
            delete data.autoPins[id];
          });
      } else if (owned === undefined) {
        // Persist before the native write. A lost receipt must not claim a manual pin.
        await this.store.update((data) => {
          data.autoPins[id] = null;
        });
        if (workspace.pinnedAt) continue;
        if (!current()) {
          await this.store.update((data) => {
            delete data.autoPins[id];
          });
          continue;
        }
        const pinnedAt = await this.host.setPinned(id, true);
        await this.store.update((data) => {
          data.autoPins[id] = pinnedAt;
        });
      } else if (owned !== null && workspace.pinnedAt !== owned) {
        await this.store.update((data) => {
          data.autoPins[id] = null;
        });
      }
    }
    if (!connected()) return;
    const active = new Set(
      inventory.workspaces.map((workspace) => workspace.id),
    );
    await this.store.update((data) => {
      for (const id of Object.keys(data.autoPins))
        if (!active.has(id)) delete data.autoPins[id];
    });
  }
  private async saveSettings(
    settings: Settings,
    revision: number,
    expectedSettings?: Settings,
  ): Promise<void> {
    const previous = this.store.current;
    const unchanged = (data: typeof previous) =>
      expectedSettings
        ? isDeepStrictEqual(data.settings, expectedSettings)
        : data.revision === revision;
    if (!unchanged(previous))
      throw new Error("Settings changed; refresh before saving");
    const next = settingsSchema.parse(settings);
    if (
      next.defaultStartGroup &&
      isTerminalGroup(next.defaultStartGroup, next.groups)
    )
      throw new Error("group-default-terminal");
    if (next.autoArchive) next.archiveMappingNeedsReview = false;
    const previousIds = previous.settings.groups.map((group) => group.id);
    const nextIds = next.groups.map((group) => group.id);
    const retained = nextIds.filter((id) => previousIds.includes(id));
    if (
      !sameOrder(
        retained,
        previousIds.filter((id) => nextIds.includes(id)),
      )
    )
      throw new Error("Groups cannot be reordered here");
    if (nextIds.slice(retained.length).some((id) => previousIds.includes(id)))
      throw new Error("Groups cannot be reordered here");
    if (!sameOrder(next.groupOrder, previous.settings.groupOrder))
      throw new Error("Group order changed; refresh before saving");
    next.groupOrder = previous.settings.groupOrder.length
      ? orderedGroups({
          groups: next.groups,
          groupOrder: previous.settings.groupOrder,
        }).map((group) => group.id)
      : [];
    const removed = previous.settings.groups.filter(
      (group) => !next.groups.some((candidate) => candidate.id === group.id),
    );
    for (const task of previous.tasks.filter((task) => !hidden(task))) {
      if (task.binding) {
        const oldGroup = previous.settings.groups.find(
          (group) => group.id === task.binding!.stage,
        )!;
        const newGroup = next.groups.find(
          (group) => group.id === task.binding!.stage,
        );
        if (
          !newGroup ||
          newGroup.kind !== oldGroup.kind ||
          newGroup.label !== oldGroup.label
        )
          throw new Error(
            "A workspace binding still uses this group; finish binding first",
          );
      }
      if (!task.workspaceId && !isDraftGroup(task.draftStage, next.groups))
        throw new Error(
          removed.some((group) => group.id === task.draftStage)
            ? "group-tasks-in-use"
            : "Move the drafts out before deleting this group or changing its type",
        );
    }
    if (removed.length) {
      const epoch = this.epoch;
      const inventory = await this.inventoryNow();
      if (epoch !== this.epoch || !this.connected)
        throw new Error("Workspaces changed; refresh before deleting a group");
      for (const group of removed) {
        const missingTasks = previous.tasks.some(
          (task) =>
            !hidden(task) &&
            task.workspaceId &&
            task.lastStage === group.id &&
            !inventory.workspaces.some(
              (workspace) => workspace.id === task.workspaceId,
            ),
        );
        if (
          missingTasks ||
          inventory.workspaces.some((workspace) =>
            workspace.labels.some(
              (label) => labelKey(label) === labelKey(group.label),
            ),
          )
        )
          throw new Error("group-tasks-in-use");
        if (
          group.id ===
            defaultGroup(previous.settings.groups, next.defaultDraftGroup) ||
          group.id ===
            defaultWorkspaceGroup(
              previous.settings.groups,
              next.defaultStartGroup,
            ) ||
          group.id === next.defaultStartWorkGroup
        )
          throw new Error("group-default-in-use");
      }
    }
    if (
      next.defaultStartWorkGroup &&
      groupKind(next.defaultStartWorkGroup, next.groups) !== "in-progress"
    ) {
      if (
        next.defaultStartWorkGroup ===
          previous.settings.defaultStartWorkGroup &&
        groupKind(next.defaultStartWorkGroup, previous.settings.groups) ===
          "in-progress"
      )
        throw new Error("group-default-in-use");
      throw new Error("group-default-start-work-invalid");
    }
    await this.store.update((data) => {
      if (!unchanged(data))
        throw new Error("Settings changed; refresh before saving");
      for (const group of removed) delete data.cardOrderByStage[group.id];
      data.settings = next;
    });
  }
  private checkCardOrder(
    data: Data,
    input: Extract<Mutation, { action: "reorder-cards" | "reset-card-order" }>,
  ): void {
    if (!data.settings.groups.some((group) => group.id === input.stage))
      throw new Error("Group no longer exists");
    const current = cardsForStage(
      this.snapshot(data).cards,
      input.stage,
      data.cardOrderByStage,
    ).map((card) => card.id);
    if (!sameOrder(input.expectedOrder, current))
      throw new Error("card-order-changed");
    if (input.action === "reorder-cards") {
      const mover = data.tasks.find((task) => task.id === input.taskId);
      if (
        !mover ||
        !current.includes(input.taskId) ||
        mover.archived !== null ||
        mover.binding !== null
      )
        throw new Error("card-order-mover-unavailable");
      if (
        input.cardOrder.length !== current.length ||
        new Set(input.cardOrder).size !== current.length ||
        input.cardOrder.some((id) => !current.includes(id)) ||
        !sameOrder(
          input.cardOrder.filter((id) => id !== input.taskId),
          current.filter((id) => id !== input.taskId),
        )
      )
        throw new Error("card-order-invalid");
    }
  }
  private checkStageExpected(
    data: Data,
    input: Extract<Mutation, { action: "stage" }>,
  ): void {
    if (input.expectedGroup) {
      const group = data.settings.groups.find(
        (group) => group.id === input.stage,
      );
      const expected = input.expectedGroup;
      if (
        !group ||
        expected.id !== group.id ||
        expected.kind !== group.kind ||
        expected.label !== group.label
      )
        throw new Error("stage-group-changed");
    }
    if (
      input.expectedUpdatedAt !== undefined &&
      data.tasks.find((task) => task.id === input.taskId)?.updatedAt !==
        input.expectedUpdatedAt
    )
      throw new Error("stage-task-changed");
  }
  async mutate(input: Mutation): Promise<Board> {
    // Reject before queueing so an active or queued start cannot be canceled after it fails.
    if (
      input.action === "cancel-binding" &&
      (this.bindingInFlight.has(input.operationId) ||
        this.queuedStarts.has(input.taskId))
    )
      throw new Error(CANCEL_BINDING_BUSY_ERROR_CODE);
    if (input.action === "start")
      this.queuedStarts.set(
        input.taskId,
        (this.queuedStarts.get(input.taskId) ?? 0) + 1,
      );
    this.epoch++;
    this.pendingMutations++;
    return this.serial(async () => {
      if (!this.connected)
        throw new Error(this.error ?? "Paseo is disconnected");
      try {
        if (input.action === "create") {
          const stage =
            input.stage ??
            defaultGroup(
              this.store.current.settings.groups,
              this.store.current.settings.defaultDraftGroup,
            );
          if (groupKind(stage, this.store.current.settings.groups) !== "todo")
            throw new Error("Choose a To do group for a new draft");
          await this.store.update((data) => {
            const task = newTask(
              randomUUID(),
              input.title,
              this.stamp(),
              stage,
            );
            task.description = input.description;
            task.projectId = input.projectId;
            task.orchestratorId = input.orchestratorId ?? null;
            task.projectName =
              this.inventory.projects.find((p) => p.id === input.projectId)
                ?.name ?? "";
            data.tasks.push(task);
          });
        } else if (input.action === "refine") {
          await this.refine(input.taskId);
        } else if (input.action === "review") {
          await this.review(input.taskId, input.outcome, input.feedback);
        } else if (input.action === "orchestrator-defaults") {
          await this.store.update((data) => {
            data.orchestrator = orchestratorSchema.parse({
              ...data.orchestrator,
              ...input.orchestrator,
            });
          });
        } else if (input.action === "orchestrator-save") {
          const id = input.orchestrator.id ?? randomUUID();
          const next = orchestratorConfigSchema.parse({
            ...input.orchestrator,
            id,
          });
          const created = !this.store.current.orchestrators.some(
            (o) => o.id === id,
          );
          await this.store.update((data) => {
            data.orchestrators = created
              ? [...data.orchestrators, next]
              : data.orchestrators.map((o) => (o.id === id ? next : o));
          });
          await this.log(id, "info", created ? "Created" : "Settings saved");
          await this.orchestrate();
        } else if (input.action === "orchestrator-delete") {
          this.orchestratorConfig(input.id);
          await this.store.update((data) => {
            data.orchestrators = data.orchestrators.filter(
              (o) => o.id !== input.id,
            );
            delete data.orchestratorRuntime[input.id];
            delete data.orchestratorLogs[input.id];
            for (const task of data.tasks)
              if (task.orchestratorId === input.id) task.orchestratorId = null;
          });
        } else if (input.action === "orchestrator-run") {
          const config = this.orchestratorConfig(input.id);
          await this.setRuntime(input.id, {
            quota: config.batchSize,
            started: 0,
            runStartedAt: this.stamp(),
          });
          await this.log(
            input.id,
            "info",
            `Run now: up to ${config.batchSize} tasks, ${config.maxConcurrent} at a time`,
          );
          await this.orchestrate();
        } else if (input.action === "orchestrator-stop") {
          this.orchestratorConfig(input.id);
          await this.setRuntime(input.id, { quota: 0, runStartedAt: null });
          await this.log(
            input.id,
            "info",
            "Stopped: no new tasks start; running agents keep going",
          );
        } else if (input.action === "settings") {
          await this.saveSettings(
            input.settings,
            input.revision,
            input.expectedSettings,
          );
          await this.reconcile();
          this.changed();
        } else if (
          input.action === "reorder-cards" ||
          input.action === "reset-card-order"
        ) {
          this.checkCardOrder(this.store.current, input);
          await this.store.update((data) => {
            this.checkCardOrder(data, input);
            if (input.action === "reset-card-order")
              delete data.cardOrderByStage[input.stage];
            else data.cardOrderByStage[input.stage] = input.cardOrder;
          });
        } else if (input.action === "reorder-groups") {
          const current = orderedGroups(this.store.current.settings).map(
            (group) => group.id,
          );
          const groups = this.store.current.settings.groups;
          if (!sameOrder(input.expectedGroupOrder, current))
            throw new Error("Group order changed; refresh before reordering");
          if (
            input.groupOrder.length !== groups.length ||
            input.groupOrder.some(
              (id) => !groups.some((group) => group.id === id),
            )
          )
            throw new Error("Group order is invalid");
          await this.store.update((data) => {
            const fresh = orderedGroups(data.settings).map((group) => group.id);
            if (!sameOrder(input.expectedGroupOrder, fresh))
              throw new Error("Group order changed; refresh before reordering");
            data.settings.groupOrder = input.groupOrder;
          });
        } else {
          const task = this.task(input.taskId);
          if (hidden(task) && input.action !== "resolve-archive")
            throw new Error(
              input.action === "detach-draft"
                ? "detach-draft-archived"
                : "Task is archived",
            );
          if (input.action === "edit") {
            await this.store.update((data) => {
              const current = data.tasks.find((t) => t.id === task.id)!;
              if (current.updatedAt !== input.updatedAt)
                throw new Error("Task changed; refresh before saving");
              if (!current.workspaceId) {
                current.title = input.title;
                current.projectId = input.projectId;
                current.projectName =
                  this.inventory.projects.find((p) => p.id === input.projectId)
                    ?.name ?? "";
              }
              current.description = input.description;
              if (input.orchestratorId !== undefined)
                current.orchestratorId = input.orchestratorId;
              current.updatedAt = this.stamp(current.updatedAt);
            });
            await this.orchestrate();
          } else if (input.action === "start") {
            if (!task.binding && task.workspaceId)
              throw new Error("Task already has a workspace");
            const stage =
              input.stage ??
              task.binding?.stage ??
              defaultStartWorkGroup(
                this.store.current.settings.groups,
                this.store.current.settings.defaultStartWorkGroup,
              );
            if (
              !stage ||
              !this.store.current.settings.groups.some(
                (group) => group.id === stage,
              )
            )
              throw new Error("Add an In progress group before starting work");
            if (isDraftGroup(stage, this.store.current.settings.groups))
              throw new Error(
                "Choose a working or completed group for the workspace",
              );
            if (
              task.binding &&
              (JSON.stringify(task.binding.target) !==
                JSON.stringify(input.target) ||
                task.binding.stage !== stage)
            )
              throw new Error(
                "A previous binding is pending; retry its original target",
              );
            if (!task.binding)
              await this.store.update((data) => {
                data.tasks.find((t) => t.id === task.id)!.binding = {
                  operationId: randomUUID(),
                  target: input.target,
                  workspaceId: null,
                  stage,
                };
              });
            await this.bind(task.id);
            await this.reconcile();
          } else if (input.action === "stage") {
            const check = () => {
              if (
                input.expectedUpdatedAt !== undefined ||
                input.expectedGroup !== undefined
              )
                this.checkStageExpected(this.store.current, input);
            };
            check();
            if (
              !this.store.current.settings.groups.some(
                (group) => group.id === input.stage,
              )
            )
              throw new Error("Group no longer exists");
            if (task.binding)
              throw new Error("Workspace binding is still pending");
            if (task.workspaceId) {
              const workspace = await this.transition(
                task.workspaceId,
                input.stage,
                input.expectedLabels,
                check,
              );
              this.inventory.workspaces = this.inventory.workspaces.map((w) =>
                w.id === workspace.id ? workspace : w,
              );
              await this.store.update((data) => {
                const current = data.tasks.find((t) => t.id === task.id)!;
                this.checkStageExpected(data, input);
                current.lastStage = input.stage;
                current.updatedAt = this.stamp(current.updatedAt);
                if (current.issue === "labels-conflict") current.issue = null;
              });
              this.changed(workspace.id);
            } else {
              if (
                !isDraftGroup(input.stage, this.store.current.settings.groups)
              )
                throw new Error("Start work and bind a workspace first");
              await this.store.update((data) => {
                const current = data.tasks.find((t) => t.id === task.id)!;
                this.checkStageExpected(data, input);
                current.draftStage = input.stage;
                current.lastStage = input.stage;
                current.updatedAt = this.stamp(current.updatedAt);
              });
              // A draft moved to Ready to start may be taken right away.
              await this.orchestrate();
            }
          } else if (input.action === "archive-draft") {
            if (
              task.workspaceId ||
              groupKind(task.draftStage, this.store.current.settings.groups) !==
                "canceled" ||
              task.binding
            )
              throw new Error(
                "Only canceled, unbound drafts can be archived here",
              );
            await this.store.update((data) => {
              data.tasks.find((t) => t.id === task.id)!.archived = {
                operationId: randomUUID(),
                kind: "draft",
                status: "archived",
                stage: task.draftStage,
                group:
                  data.settings.groups.find(
                    (group) => group.id === task.draftStage,
                  ) ?? null,
                startedAt: this.stamp(),
                archivedAt: this.stamp(),
                lastConversationAt: null,
                detail: "Draft archived; no native workspace",
              };
            });
          } else if (input.action === "detach-draft") {
            await this.store.update((data) => {
              const current = data.tasks.find((t) => t.id === task.id)!;
              if (current.updatedAt !== input.updatedAt)
                throw new Error("detach-draft-stale");
              const source = current.mergedDrafts.find(
                (source) => source.draftId === input.draftId,
              );
              if (!source) throw new Error("detach-draft-missing");
              if (data.tasks.some((t) => t.id === source.draftId))
                throw new Error("detach-draft-id-in-use");
              const start = current.description.indexOf(source.appendedText);
              if (
                start < 0 ||
                current.description.indexOf(source.appendedText, start + 1) >= 0
              )
                throw new Error("detach-draft-text-changed");
              const draft = newTask(
                source.draftId,
                source.title,
                this.stamp(),
                defaultGroup(
                  data.settings.groups,
                  data.settings.defaultDraftGroup,
                ),
              );
              draft.description = source.description;
              current.description =
                current.description.slice(0, start) +
                current.description.slice(start + source.appendedText.length);
              current.mergedDrafts = current.mergedDrafts.filter(
                (entry) => entry !== source,
              );
              current.updatedAt = this.stamp(current.updatedAt);
              data.tasks.push(draft);
            });
          } else if (input.action === "cancel-binding") {
            if (!task.binding) throw new Error("cancel-binding-missing");
            if (task.binding.operationId !== input.operationId)
              throw new Error("cancel-binding-changed");
            await this.store.update((data) => {
              const current = data.tasks.find((t) => t.id === task.id)!;
              current.binding = null;
              current.issue = null;
              current.updatedAt = this.stamp(current.updatedAt);
            });
          } else if (input.action === "resolve-archive") {
            await this.store.update((data) => {
              const current = data.tasks.find((t) => t.id === task.id)!;
              if (current.updatedAt !== input.updatedAt)
                throw new Error("archive-resolution-stale");
              const archive = current.archived;
              if (
                !archive ||
                (!["uncertain", "external"].includes(archive.status) &&
                  !(
                    archive.kind === "draft" &&
                    archive.status === "archived" &&
                    input.outcome === "restore"
                  ))
              )
                throw new Error("archive-resolution-unavailable");
              if (archive.operationId !== input.operationId)
                throw new Error("archive-resolution-stale");
              if (input.outcome === "confirm") {
                current.archived = {
                  ...archive,
                  status: "archived",
                  detail: "archive-confirmed-by-user",
                };
                current.issue = null;
              } else {
                if (
                  !data.settings.groups.some(
                    (group) => group.id === archive.stage,
                  )
                )
                  throw new Error("archive-group-unavailable");
                if (
                  archive.kind === "draft" &&
                  !isDraftGroup(archive.stage, data.settings.groups)
                )
                  throw new Error("archive-draft-group-unavailable");
                current.archived = null;
                if (archive.kind === "draft")
                  current.draftStage = archive.stage;
                current.lastStage = archive.stage;
                // Keep the manual restore until reconciliation confirms native membership.
                current.issue = current.workspaceId
                  ? "archive-restored-workspace-unavailable"
                  : null;
              }
              current.updatedAt = this.stamp(current.updatedAt);
            });
            this.archiveDeferrals.delete(task.id);
          }
        }
        return this.snapshot();
      } catch (error) {
        try {
          await this.load();
        } catch (storageError) {
          this.disconnected(message(storageError));
        }
        throw error;
      }
    }).finally(() => {
      this.pendingMutations--;
      if (input.action === "start") {
        const remaining = this.queuedStarts.get(input.taskId)! - 1;
        if (remaining) this.queuedStarts.set(input.taskId, remaining);
        else this.queuedStarts.delete(input.taskId);
      }
    });
  }
  private async bind(id: string): Promise<void> {
    const draft = this.task(id);
    const binding = draft.binding;
    if (!binding) return;
    this.bindingInFlight.add(binding.operationId);
    try {
      const workspaceId =
        binding.workspaceId ??
        (binding.target.kind === "existing"
          ? binding.target.workspaceId
          : await this.host.create(
              binding.target.source,
              draft.title,
              `workboard:${binding.operationId}`,
            ));
      const workspace = await this.host.workspace(workspaceId);
      if (!workspace) throw new Error("Binding workspace is unavailable");
      let survivorId = id;
      await this.store.update((data) => {
        const current = data.tasks.find((t) => t.id === id)!;
        const imported = data.tasks.find(
          (t) => t.workspaceId === workspaceId && t.id !== id,
        );
        if (binding.target.kind === "existing" && imported) {
          const appendedText = `${imported.description ? "\n\n" : ""}[${current.title}]\n${current.description}`;
          imported.description += appendedText;
          imported.mergedDrafts.push({
            draftId: current.id,
            title: current.title,
            description: current.description,
            mergedAt: this.stamp(),
            appendedText,
          });
          imported.binding = { ...binding, workspaceId };
          imported.updatedAt = this.stamp(imported.updatedAt);
          survivorId = imported.id;
          data.tasks = data.tasks.filter((t) => t.id !== id);
        } else {
          if (imported) {
            current.description = [current.description, imported.description]
              .filter(Boolean)
              .join("\n\n");
            data.tasks = data.tasks.filter((t) => t.id !== imported.id);
          }
          if (binding.target.kind === "existing" && !binding.workspaceId)
            current.description = `[${current.title}]\n${current.description}`;
          current.workspaceId = workspaceId;
          current.binding = { ...binding, workspaceId };
          current.updatedAt = this.stamp(current.updatedAt);
        }
      });
      try {
        await this.transition(
          workspaceId,
          binding.stage,
          statusLabels(workspace.labels, this.store.current.settings.groups),
        );
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === survivorId)!;
          task.binding = null;
          task.issue = null;
        });
      } catch (error) {
        await this.issue(survivorId, "label-sync-incomplete");
        throw error;
      }
    } finally {
      this.bindingInFlight.delete(binding.operationId);
    }
  }
  private async transition(
    id: string,
    stage: Stage,
    expected: string[],
    check: () => void = () => {},
  ): Promise<Workspace> {
    const mapping = this.store.current.settings.groups;
    const group = mapping.find((group) => group.id === stage);
    if (!group) throw new Error("Group no longer exists");
    let workspace = await this.host.workspace(id);
    check();
    if (!workspace || workspace.archivingAt)
      throw new Error("Workspace is unavailable or archiving");
    if (!labelsEqual(statusLabels(workspace.labels, mapping), expected))
      throw new Error(
        "Workspace labels changed; refresh before changing stage",
      );
    const target = group.label;
    let observed = workspace.labels;
    const operations: Array<{ name: string; assigned: boolean }> = [];
    if (!observed.some((name) => labelKey(name) === labelKey(target)))
      operations.push({ name: target, assigned: true });
    for (const name of statusLabels(observed, mapping))
      if (labelKey(name) !== labelKey(target))
        operations.push({ name, assigned: false });
    for (const operation of operations) {
      workspace = await this.host.workspace(id);
      check();
      if (
        !workspace ||
        !labelsEqual(
          statusLabels(workspace.labels, mapping),
          statusLabels(observed, mapping),
        )
      )
        throw new Error("Workspace labels changed during synchronization");
      const intended = operation.assigned
        ? [...observed, operation.name]
        : observed.filter(
            (name) => labelKey(name) !== labelKey(operation.name),
          );
      observed = await this.host.setLabel(
        id,
        operation.name,
        STAGE_COLORS[group.kind],
        operation.assigned,
      );
      check();
      if (
        !labelsEqual(
          statusLabels(observed, mapping),
          statusLabels(intended, mapping),
        )
      )
        throw new Error("Workspace labels changed during synchronization");
    }
    workspace = await this.host.workspace(id);
    check();
    if (
      !workspace ||
      resolveStage(
        workspace.labels,
        mapping,
        this.store.current.settings.defaultStartGroup,
      ) !== stage
    )
      throw new Error("Label synchronization could not be verified");
    return workspace;
  }
  /** Open (or reopen) the refinement chat of a draft. Runs inside `serial`. */
  private async refine(taskId: string): Promise<void> {
    const task = this.task(taskId);
    if (task.workspaceId || task.binding)
      throw new Error("Only a draft can be refined");
    const existing = this.store.current.refinements[taskId];
    if (existing && (await this.host.agentAlive(existing.agentId))) return;
    const project = this.inventory.projects.find(
      (p) => p.id === task.projectId,
    );
    if (!project) throw new Error("Choose a project for this task");
    const defaults = this.store.current.orchestrator;
    // The chat uses the agent of the task's orchestrator, but always in the refinement mode.
    const settings =
      this.store.current.orchestrators.find(
        (o) => o.id === task.orchestratorId,
      ) ?? defaults;
    const agentId = await this.host.startAgentIn(project.directory, {
      provider: settings.provider,
      modeId: defaults.refineModeId,
      thinkingOptionId: settings.thinkingOptionId,
      title: `Refine: ${task.title}`.slice(0, 200),
      prompt: refinementPrompt(task, settings.instructions),
    });
    await this.setRefinement(taskId, {
      agentId,
      status: "chatting",
      error: null,
    });
  }
  private setRefinement(
    taskId: string,
    change: Partial<Refinement> & { agentId?: string },
  ): Promise<void> {
    return this.store.update((data) => {
      const previous = data.refinements[taskId];
      if (!previous && !change.agentId) return;
      data.refinements[taskId] = {
        ...(previous ?? {
          agentId: change.agentId!,
          status: "chatting",
          error: null,
        }),
        ...change,
        updatedAt: this.stamp(),
      } as Refinement;
    });
  }
  /**
   * `/write-ticket` in a refinement chat: ask the agent for the final ticket and, once its turn
   * ends, replace the draft's title and description with it. Resolves when the request is sent.
   */
  async writeTicket(agentId: string, focus: string): Promise<void> {
    const taskId = await this.serial(async () => {
      const entry = Object.entries(this.store.current.refinements).find(
        ([, refinement]) => refinement.agentId === agentId,
      );
      if (!entry)
        throw new Error("This chat is not a Power Workboard refinement");
      const task = this.task(entry[0]);
      if (task.workspaceId) throw new Error("The task already started");
      if (entry[1].status === "writing")
        throw new Error("The ticket is already being written");
      await this.setRefinement(entry[0], { status: "writing", error: null });
      return entry[0];
    });
    void this.host
      .runAgent(agentId, writeTicketPrompt(focus))
      .then((reply) =>
        this.serial(async () => {
          const ticket = parseTicket(reply);
          await this.store.update((data) => {
            const current = data.tasks.find((t) => t.id === taskId);
            if (!current || current.workspaceId) return;
            if (ticket.title) current.title = ticket.title;
            current.description = ticket.description;
            current.updatedAt = this.stamp(current.updatedAt);
          });
          await this.setRefinement(taskId, { status: "written" });
        }),
      )
      .catch((error) =>
        this.serial(() =>
          this.setRefinement(taskId, {
            status: "failed",
            error: message(error),
          }),
        ),
      )
      .catch(() => undefined);
  }
  /** Move a task that has a workspace to another group through its labels. */
  private async moveBound(taskId: string, stage: Stage): Promise<void> {
    const task = this.task(taskId);
    if (!task.workspaceId)
      throw new Error("Start work and bind a workspace first");
    const workspace = this.inventory.workspaces.find(
      (w) => w.id === task.workspaceId,
    );
    const moved = await this.transition(
      task.workspaceId,
      stage,
      statusLabels(
        workspace?.labels ??
          (await this.host.workspace(task.workspaceId))?.labels ??
          [],
        this.store.current.settings.groups,
      ),
    );
    this.inventory.workspaces = this.inventory.workspaces.map((w) =>
      w.id === moved.id ? moved : w,
    );
    await this.store.update((data) => {
      const current = data.tasks.find((t) => t.id === taskId)!;
      current.lastStage = stage;
      current.updatedAt = this.stamp(current.updatedAt);
      if (current.issue === "labels-conflict") current.issue = null;
    });
  }
  /**
   * The reviewer's answer to a Ready to review card: Done moves it to the first Done group;
   * Continue sends it back to Ready to start with feedback, and the orchestrator hands that to
   * the same agent on its next pass (right away when it is playing). Runs inside `serial`.
   */
  private async review(
    taskId: string,
    outcome: "done" | "continue",
    feedback: string,
  ): Promise<void> {
    const task = this.task(taskId);
    if (task.binding) throw new Error("Workspace binding is still pending");
    if (!task.workspaceId)
      throw new Error("Start work and bind a workspace first");
    const target = orderedGroups(this.store.current.settings).find(
      (group) => group.kind === (outcome === "done" ? "done" : "ready"),
    );
    if (!target)
      throw new Error(
        outcome === "done"
          ? "Add a Done group first"
          : "Add a Ready to start group first",
      );
    await this.moveBound(taskId, target.id);
    if (outcome === "done") {
      if (this.store.current.orchestrations[taskId])
        await this.setOrchestration(taskId, { feedback: null });
      return;
    }
    await this.setOrchestration(taskId, {
      status: "queued",
      feedback: feedback.trim(),
      error: null,
      finishedAt: this.stamp(),
    });
    this.changed(task.workspaceId);
    await this.orchestrate();
  }
  private setOrchestration(
    taskId: string,
    change: Partial<Orchestration>,
  ): Promise<void> {
    return this.store.update((data) => {
      const previous = data.orchestrations[taskId];
      data.orchestrations[taskId] = {
        ...(previous ?? {
          status: "starting",
          workspaceId: null,
          agentId: null,
          startedAt: this.stamp(),
          finishedAt: null,
          sawRunning: false,
          error: null,
        }),
        ...change,
      };
    });
  }
  /**
   * Follow the agents the orchestrators started and move finished tasks to review. Then each
   * orchestrator whose window is open, or whose run (Run now or a daily time) still has tasks to
   * start, takes its Ready to start tasks up to its concurrency limit. Runs inside `serial`.
   */
  private async orchestrate(): Promise<void> {
    if (this.stopped || !this.connected) return;
    const groups = this.store.current.settings.groups;
    const review = orderedGroups(this.store.current.settings).find(
      (group) => group.kind === "review",
    );
    for (const [taskId, record] of Object.entries(
      this.store.current.orchestrations,
    )) {
      const task = this.store.current.tasks.find((t) => t.id === taskId);
      if (!task || hidden(task)) {
        await this.store.update((data) => {
          delete data.orchestrations[taskId];
        });
        continue;
      }
      if (record.status !== "running" || !record.agentId) continue;
      const agent = this.inventory.agents.find((a) => a.id === record.agentId);
      const elapsed = this.now() - Date.parse(record.startedAt);
      if (!agent) {
        if (elapsed > 120_000) {
          await this.setOrchestration(taskId, {
            status: "failed",
            finishedAt: this.stamp(),
            error: "The agent is gone",
          });
          await this.log(
            record.orchestratorId,
            "error",
            `"${task.title}": the agent is gone`,
            taskId,
            record.agentId,
          );
        }
        continue;
      }
      if (agent.activity === "running" || agent.activity === "waiting") {
        if (!record.sawRunning)
          await this.setOrchestration(taskId, { sawRunning: true });
        continue;
      }
      if (agent.activity === "error") {
        await this.setOrchestration(taskId, {
          status: "failed",
          finishedAt: this.stamp(),
          error: "The agent stopped with an error",
        });
        await this.log(
          record.orchestratorId,
          "error",
          `"${task.title}": the agent stopped with an error`,
          taskId,
          record.agentId,
        );
        continue;
      }
      // Idle before it was ever seen running means it may not have started yet.
      if (!record.sawRunning && elapsed < 90_000) continue;
      await this.setOrchestration(taskId, {
        status: "finished",
        finishedAt: this.stamp(),
      });
      const workspace = this.inventory.workspaces.find(
        (w) => w.id === task.workspaceId,
      );
      const summary = await this.host.lastReply(record.agentId);
      if (summary) await this.setOrchestration(taskId, { summary });
      await this.log(
        record.orchestratorId,
        "info",
        `Finished "${task.title}"; ready to review`,
        taskId,
        record.agentId,
      );
      if (
        review &&
        workspace &&
        groupKind(task.lastStage, groups) === "in-progress"
      ) {
        try {
          await this.moveBound(taskId, review.id);
        } catch (error) {
          await this.setOrchestration(taskId, { error: message(error) });
        }
      }
    }
    const stage = defaultStartWorkGroup(
      groups,
      this.store.current.settings.defaultStartWorkGroup,
    );
    if (!stage) return;
    const board = this.snapshot();
    const ready = orderedGroups(this.store.current.settings)
      .filter((group) => group.kind === "ready")
      .flatMap((group) =>
        cardsForStage(board.cards, group.id, board.cardOrderByStage),
      )
      .filter((card) => this.eligible(card));
    const taken = new Set<string>();
    let started = false;
    for (const config of [...this.store.current.orchestrators]) {
      if (this.stopped) break;
      if (config.enabled) {
        const due = dueTrigger(
          config.schedule,
          this.runtime(config.id).lastTriggerAt,
          this.now(),
        );
        if (due !== null) {
          await this.setRuntime(config.id, {
            quota: config.batchSize,
            started: 0,
            runStartedAt: this.stamp(),
            lastTriggerAt: new Date(due).toISOString(),
          });
          await this.log(
            config.id,
            "info",
            `Scheduled run: up to ${config.batchSize} tasks`,
          );
        }
      }
      const open = config.enabled && windowOpen(config.schedule, this.now());
      const quota = this.runtime(config.id).quota;
      if (quota <= 0 && !open) continue;
      const mine = ready.filter(
        (card) => !taken.has(card.id) && this.owns(config, card),
      );
      if (!mine.length) {
        if (quota > 0)
          await this.endRun(config.id, "nothing left in Ready to start");
        continue;
      }
      let slots = config.maxConcurrent - this.runningFor(config.id);
      for (const card of mine) {
        if (slots <= 0 || this.stopped) break;
        const runtime = this.runtime(config.id);
        if (!open && runtime.quota <= 0) break;
        taken.add(card.id);
        const outcome = await this.startCard(config, card, stage);
        if (outcome === "skipped") continue;
        slots--;
        started = true;
        if (runtime.quota > 0) {
          await this.setRuntime(config.id, {
            quota: runtime.quota - 1,
            started: runtime.started + 1,
          });
          if (runtime.quota === 1) await this.endRun(config.id, "batch done");
        }
      }
    }
    if (started) await this.reconcile();
  }
  /** Whether a Ready to start card may be started (or continued) now. */
  private eligible(card: Card): boolean {
    const record = this.store.current.orchestrations[card.id];
    if (card.binding || card.archived) return false;
    // A task sent back from review keeps its workspace and waits here.
    if (card.workspaceId)
      return (
        record?.status === "queued" ||
        (record?.status === "failed" &&
          record.feedback !== null &&
          Date.parse(card.updatedAt) > Date.parse(record.finishedAt ?? ""))
      );
    // A failed start is retried only after the task was edited.
    return (
      !record ||
      (record.status === "failed" &&
        !record.workspaceId &&
        Date.parse(card.updatedAt) > Date.parse(record.finishedAt ?? ""))
    );
  }
  /**
   * A task chosen for an orchestrator belongs to it; one sent back from review stays with the
   * orchestrator that ran it; any other task goes to the first orchestrator of its project.
   */
  private owns(
    config: OrchestratorConfig,
    task: Pick<Task, "id" | "orchestratorId" | "projectId">,
    data: Data = this.store.current,
  ): boolean {
    const exists = (id: string | null | undefined): id is string =>
      !!id && data.orchestrators.some((o) => o.id === id);
    if (exists(task.orchestratorId)) return task.orchestratorId === config.id;
    const ran = data.orchestrations[task.id]?.orchestratorId;
    if (exists(ran)) return ran === config.id;
    return config.projectId === null || config.projectId === task.projectId;
  }
  private runningFor(id: string, data: Data = this.store.current): number {
    return Object.values(data.orchestrations).filter(
      (record) =>
        record.orchestratorId === id &&
        (record.status === "starting" || record.status === "running"),
    ).length;
  }
  private orchestratorConfig(id: string): OrchestratorConfig {
    const config = this.store.current.orchestrators.find((o) => o.id === id);
    if (!config) throw new Error("Orchestrator no longer exists");
    return config;
  }
  private runtime(
    id: string,
    data: Data = this.store.current,
  ): OrchestratorRuntime {
    return (
      data.orchestratorRuntime[id] ?? {
        quota: 0,
        started: 0,
        runStartedAt: null,
        lastTriggerAt: null,
      }
    );
  }
  private setRuntime(
    id: string,
    change: Partial<OrchestratorRuntime>,
  ): Promise<void> {
    return this.store.update((data) => {
      data.orchestratorRuntime[id] = { ...this.runtime(id, data), ...change };
    });
  }
  private async endRun(id: string, why: string): Promise<void> {
    const runtime = this.runtime(id);
    await this.setRuntime(id, { quota: 0, runStartedAt: null });
    await this.log(
      id,
      "info",
      `Run finished (${why}): ${runtime.started} started`,
    );
  }
  private log(
    id: string | null | undefined,
    level: "info" | "warn" | "error",
    text: string,
    taskId: string | null = null,
    agentId: string | null = null,
  ): Promise<void> {
    if (!id) return Promise.resolve();
    return this.store.update((data) => {
      if (!data.orchestrators.some((o) => o.id === id)) return;
      const entries = data.orchestratorLogs[id] ?? [];
      entries.push({ at: this.stamp(), level, text, taskId, agentId });
      data.orchestratorLogs[id] = entries.slice(-ORCHESTRATOR_LOG_LIMIT);
    });
  }
  private orchestratorStatus(config: OrchestratorConfig, data: Data) {
    const readyStages = new Set(
      data.settings.groups
        .filter((group) => group.kind === "ready")
        .map((group) => group.id),
    );
    const waiting = data.tasks.filter(
      (task) =>
        !task.archived &&
        readyStages.has(task.workspaceId ? task.lastStage : task.draftStage) &&
        this.owns(config, task, data),
    ).length;
    const next = config.enabled ? nextRunAt(config.schedule, this.now()) : null;
    return {
      active:
        this.runtime(config.id, data).quota > 0 ||
        (config.enabled && windowOpen(config.schedule, this.now())),
      running: this.runningFor(config.id, data),
      waiting,
      nextRunAt: next === null ? null : new Date(next).toISOString(),
    };
  }
  /** Start one Ready to start card for an orchestrator. "skipped" leaves its slot free. */
  private async startCard(
    config: OrchestratorConfig,
    card: Card,
    stage: Stage,
  ): Promise<"started" | "failed" | "skipped"> {
    if (card.workspaceId) return this.continueTask(card.id, stage, config);
    const project = this.inventory.projects.find(
      (p) => p.id === (card.projectId ?? config.projectId),
    );
    if (!project) {
      await this.setOrchestration(card.id, {
        status: "failed",
        startedAt: this.stamp(),
        finishedAt: this.stamp(),
        error: "Choose a project for this task",
        orchestratorId: config.id,
      });
      await this.log(
        config.id,
        "warn",
        `Skipped "${card.title}": choose a project for it`,
        card.id,
      );
      return "skipped";
    }
    await this.store.update((data) => {
      delete data.orchestrations[card.id];
    });
    await this.setOrchestration(card.id, {
      status: "starting",
      orchestratorId: config.id,
    });
    try {
      const source =
        project.isGit && config.useWorktree
          ? ({ kind: "worktree", projectId: project.id } as const)
          : ({
              kind: "directory",
              path: project.directory,
              projectId: project.id,
            } as const);
      await this.store.update((data) => {
        const task = data.tasks.find((t) => t.id === card.id)!;
        task.binding = {
          operationId: randomUUID(),
          target: { kind: "new", source },
          workspaceId: null,
          stage,
        };
        // A task without a project takes the orchestrator's.
        if (!task.projectId) {
          task.projectId = project.id;
          task.projectName = project.name;
        }
      });
      await this.bind(card.id);
      const task = this.task(card.id);
      if (!task.workspaceId) throw new Error("No workspace was created");
      await this.setOrchestration(card.id, {
        workspaceId: task.workspaceId,
      });
      const agentId = await this.host.startAgent(task.workspaceId, {
        provider: config.provider,
        modeId: config.modeId,
        thinkingOptionId: config.thinkingOptionId,
        title: task.title,
        prompt: orchestratorPrompt(task, config.instructions),
      });
      await this.setOrchestration(card.id, {
        status: "running",
        agentId,
        startedAt: this.stamp(),
      });
      await this.log(
        config.id,
        "info",
        `Started "${task.title}"`,
        card.id,
        agentId,
      );
      return "started";
    } catch (error) {
      await this.setOrchestration(card.id, {
        status: "failed",
        finishedAt: this.stamp(),
        error: message(error),
      });
      await this.log(
        config.id,
        "error",
        `Could not start "${card.title}": ${message(error)}`,
        card.id,
      );
      return "failed";
    }
  }
  /** Hand the reviewer's feedback to the task's agent, or to a new one when it is gone. */
  private async continueTask(
    taskId: string,
    stage: Stage,
    settings: OrchestratorConfig,
  ): Promise<"started" | "failed"> {
    const record = this.store.current.orchestrations[taskId]!;
    const feedback = record.feedback ?? "";
    try {
      await this.moveBound(taskId, stage);
      const task = this.task(taskId);
      let agentId = record.agentId;
      if (agentId && (await this.host.agentAlive(agentId)))
        await this.host.sendAgent(agentId, continuationPrompt(feedback));
      else
        agentId = await this.host.startAgent(task.workspaceId!, {
          provider: settings.provider,
          modeId: settings.modeId,
          thinkingOptionId: settings.thinkingOptionId,
          title: task.title,
          prompt: [
            orchestratorPrompt(task, settings.instructions),
            continuationPrompt(feedback),
          ].join("\n\n"),
        });
      await this.setOrchestration(taskId, {
        status: "running",
        agentId,
        startedAt: this.stamp(),
        finishedAt: null,
        sawRunning: false,
        summary: null,
        feedback: null,
        error: null,
        orchestratorId: settings.id,
      });
      await this.log(
        settings.id,
        "info",
        `Continued "${task.title}" with the review feedback`,
        taskId,
        agentId,
      );
      return "started";
    } catch (error) {
      await this.setOrchestration(taskId, {
        status: "failed",
        finishedAt: this.stamp(),
        error: message(error),
      });
      await this.log(
        settings.id,
        "error",
        `Could not continue the task: ${message(error)}`,
        taskId,
      );
      return "failed";
    }
  }
  private issue(id: string, issue: string | null): Promise<void> {
    return this.store.update((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (task) task.issue = issue;
    });
  }
  private archiveFingerprint(
    workspace: Workspace | undefined,
    agents: readonly Agent[],
  ): string {
    return JSON.stringify([
      workspace && [
        workspace.id,
        [...workspace.labels].sort(),
        workspace.archivingAt,
        workspace.status,
        workspace.scripts,
        workspace.workspaceDirectory,
        workspace.gitRuntime?.isPaseoOwnedWorktree,
      ],
      [...agents]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((agent) => [
          agent.id,
          agent.updatedAt,
          agent.lastUserMessageAt,
          agent.activity,
          agent.archivedAt,
          agent.childEnumeration,
          agent.parentAgentId,
          agent.subagentId,
        ]),
    ]);
  }
  private archiveDeferred(
    task: Task,
    workspace: Workspace | undefined,
    agents: readonly Agent[],
  ): boolean {
    const deferred = this.archiveDeferrals.get(task.id);
    if (!deferred) return false;
    if (deferred.fingerprint !== this.archiveFingerprint(workspace, agents)) {
      this.archiveDeferrals.delete(task.id);
      return false;
    }
    return deferred.deferredUntil > this.now();
  }
  private async deferArchive(
    task: Task,
    reason: string,
    workspace: Workspace | undefined,
    agents: readonly Agent[],
  ): Promise<void> {
    const prior = this.archiveDeferrals.get(task.id);
    const attempts =
      prior?.reason === reason ? Math.min(prior.attempts + 1, 7) : 1;
    this.archiveDeferrals.set(task.id, {
      reason,
      attempts,
      deferredUntil:
        this.now() + Math.min(60_000 * 2 ** (attempts - 1), 3_600_000),
      fingerprint: this.archiveFingerprint(workspace, agents),
    });
    await this.issue(task.id, reason);
  }
  private async scan(scope?: ReadonlySet<string>): Promise<void> {
    if (!this.connected || !this.store.current.settings.autoArchive) return;
    const tasks = this.store.current.tasks;
    for (const id of this.archiveDeferrals.keys())
      if (
        !tasks.some((task) => task.id === id && !task.archived && !task.binding)
      )
        this.archiveDeferrals.delete(id);
    const candidates = tasks.filter((task) => {
      const id = task.workspaceId;
      return (
        id &&
        (!scope || scope.has(id)) &&
        !task.archived &&
        !task.binding &&
        task.issue !== "archive-restored-workspace-unavailable" &&
        archiveGate(task) !== null &&
        isArchiveDue(
          groupKind(task.lastStage, this.store.current.settings.groups),
          archiveGate(task),
          this.now(),
          this.store.current.settings.archiveAfterDays,
        ) &&
        !this.archiveDeferred(
          task,
          this.inventory.workspaces.find((w) => w.id === id),
          this.inventory.agents.filter((a) => a.workspaceId === id),
        )
      );
    });
    if (!candidates.length || this.stopped || this.pendingMutations > 0) return;
    const epochs = new Map(
      candidates.map((task) => [task.id, this.observation(task.workspaceId!)]),
    );
    const inventory = await this.inventoryNow();
    for (const candidate of candidates) {
      if (this.stopped || this.pendingMutations > 0) return;
      const id = candidate.workspaceId!;
      const epoch = epochs.get(candidate.id)!;
      const workspace = inventory.workspaces.find((w) => w.id === id);
      if (!workspace || workspace.archivingAt) {
        await this.deferArchive(
          candidate,
          "workspace-unavailable",
          workspace,
          inventory.agents.filter((a) => a.workspaceId === id),
        );
        continue;
      }
      const stage = resolveStage(
        workspace.labels,
        this.store.current.settings.groups,
        this.store.current.settings.defaultStartGroup,
      );
      const agents = inventory.agents.filter(
        (agent) => agent.workspaceId === id,
      );
      if (
        agents.some(
          (a) =>
            !a.archivedAt &&
            (a.activity === "running" || a.activity === "waiting"),
        ) ||
        workspace.status === "running" ||
        workspace.status === "needs_input"
      ) {
        await this.deferArchive(candidate, "agent-busy", workspace, agents);
        continue;
      }
      const gate = await this.verifyConversation(candidate, agents);
      if (gate === null) {
        await this.deferArchive(
          candidate,
          "conversation-unknown",
          workspace,
          agents,
        );
        continue;
      }
      if (
        !isArchiveDue(
          groupKind(stage, this.store.current.settings.groups),
          gate,
          this.now(),
          this.store.current.settings.archiveAfterDays,
        )
      ) {
        this.archiveDeferrals.delete(candidate.id);
        continue;
      }
      const safety = await this.host.safety(workspace);
      if (safety) {
        await this.deferArchive(candidate, safety, workspace, agents);
        continue;
      }
      if (this.stopped || epoch !== this.observation(id)) {
        if (!this.stopped)
          await this.deferArchive(
            candidate,
            "changed-during-check",
            workspace,
            agents,
          );
        continue;
      }
      const operationId = randomUUID();
      await this.store.update((data) => {
        data.tasks.find((t) => t.id === candidate.id)!.archived = {
          operationId,
          kind: "automatic",
          status: "pending",
          stage,
          group:
            data.settings.groups.find((group) => group.id === stage) ?? null,
          startedAt: this.stamp(),
          archivedAt: null,
          lastConversationAt: candidate.lastConversationAt,
          detail: "Archive intent persisted; native result not yet known",
        };
      });
      // Storage and safety checks can take time. Re-read membership, labels and Agent state before sending.
      let finalIssue: string | null = null;
      try {
        const fresh = await this.inventoryNow();
        const current = fresh.workspaces.find((w) => w.id === id);
        const currentAgents = fresh.agents.filter((a) => a.workspaceId === id);
        const fingerprint = (items: typeof agents) =>
          JSON.stringify(
            items
              .map((a) => [
                a.id,
                a.updatedAt,
                a.lastUserMessageAt,
                a.activity,
                a.archivedAt,
                a.childEnumeration,
              ])
              .sort(),
          );
        if (
          !current ||
          current.archivingAt ||
          current.status === "running" ||
          current.status === "needs_input" ||
          // A refused child listing for an archived parent keeps the gate on its recorded
          // bounds, so it must not defer the archive forever as a state change would.
          resolveStage(
            current.labels,
            this.store.current.settings.groups,
            this.store.current.settings.defaultStartGroup,
          ) !== stage ||
          !labelsEqual(current.labels, workspace.labels) ||
          fingerprint(currentAgents) !== fingerprint(agents)
        )
          finalIssue = "changed-during-check";
        else finalIssue = await this.host.safety(current);
      } catch {
        finalIssue = "changed-during-check";
      }
      if (this.stopped) return; // Keep the persisted intent uncertain on the next startup.
      if (epoch !== this.observation(id)) finalIssue = "changed-during-check";
      if (finalIssue) {
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === candidate.id)!;
          task.archived = null;
          task.issue = finalIssue;
        });
        await this.deferArchive(candidate, finalIssue, workspace, agents);
        continue;
      }
      this.archiveDeferrals.delete(candidate.id);
      try {
        const result = await this.host.archive(id);
        if (result.error || !result.archivedAt)
          throw new Error(
            result.error ?? "Native archive returned no timestamp",
          );
        const active = await this.inventoryNow();
        this.inventory = active;
        if (active.workspaces.some((w) => w.id === id))
          throw new Error(
            "Native workspace still active after archive response",
          );
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === candidate.id)!;
          task.archived = {
            ...task.archived!,
            status: "archived",
            archivedAt: result.archivedAt,
            detail:
              "Native archive confirmed; worktree cleanup is not independently verified",
          };
          task.issue = null;
        });
      } catch (error) {
        await this.store.update((data) => {
          const task = data.tasks.find((t) => t.id === candidate.id)!;
          task.archived = {
            ...task.archived!,
            status: "uncertain",
            detail: message(error),
          };
          task.issue = "native-archive-unknown";
        });
      }
    }
  }
  dispose(): void {
    this.stopped = true;
    this.epoch++;
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.host.dispose();
  }
}
