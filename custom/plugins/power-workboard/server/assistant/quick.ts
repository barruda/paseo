// CUSTOM(assistant-quick): the inbox of quick messages. It sends each one to the Projects
// Assistant chat wrapped by `quickPrompt`, waits for the assistant's `board_ack`, and falls back
// to classifying its reply when the turn ends without one. Kept in memory: the status row only
// needs the recent ones, and a daemon restart starts it empty.
import { randomUUID } from "node:crypto";
import {
  QUICK_WAIT_MAX_MS,
  classifyReply,
  oneLine,
  quickPrompt,
  toQuickAck,
  type AckStatus,
  type QuickAck,
  type QuickMessage,
} from "../../shared/quick";

type Activity = "idle" | "running" | "waiting" | "attention" | "error";

export interface QuickInboxDeps {
  /** The chat agent's id, starting a chat when there is none. */
  openChat(): Promise<string>;
  send(agentId: string, text: string): Promise<void>;
  /** Null when the agent is gone or archived. */
  activity(agentId: string): Promise<Activity | null>;
  lastReply(agentId: string): Promise<string | null>;
  serverId(): string | null;
  now?: () => number;
  /** How often the watcher looks at the chat. */
  pollMs?: number;
  /** A turn may still not have started after this long; then an idle chat counts as done. */
  startGraceMs?: number;
  /** The watcher gives up (and leaves the message pending) after this long. */
  watchMs?: number;
}

const KEEP = 30;

export class QuickInbox {
  private entries: QuickMessage[] = [];
  private waiters = new Map<string, Set<() => void>>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(private readonly deps: QuickInboxDeps) {}

  /** Newest first. */
  list(): QuickMessage[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  /** Sends `text` to the assistant and waits up to `waitMs` for its ack. */
  async ask(input: {
    text: string;
    source: string;
    waitMs: number;
  }): Promise<QuickAck> {
    // The wait counts from the call: opening a new chat can take seconds of the RPC's 30.
    const started = this.now();
    const entry: QuickMessage = {
      id: `q-${randomUUID().slice(0, 8)}`,
      text: input.text,
      source: input.source,
      sentAt: this.stamp(),
      agentId: null,
      status: "pending",
      message: null,
      ackedAt: null,
      inferred: false,
    };
    this.entries.unshift(entry);
    this.entries.length = Math.min(this.entries.length, KEEP);
    try {
      const agentId = await this.deps.openChat();
      entry.agentId = agentId;
      const before = await this.deps.lastReply(agentId);
      await this.deps.send(
        agentId,
        quickPrompt(entry.id, input.text, input.source),
      );
      entry.sentAt = this.stamp();
      this.watch(entry, agentId, before);
    } catch (error) {
      this.settle(
        entry,
        "error",
        `Could not reach the assistant: ${reason(error)}`,
        false,
      );
    }
    return this.get(
      entry.id,
      Math.max(0, input.waitMs - (this.now() - started)),
    );
  }

  /** The current ack of a message, waiting up to `waitMs` while it is pending. */
  async get(id: string, waitMs = 0): Promise<QuickAck> {
    const entry = this.find(id);
    if (entry.status === "pending" && waitMs > 0)
      await this.waitFor(id, Math.min(waitMs, QUICK_WAIT_MAX_MS));
    return toQuickAck(entry, this.deps.serverId());
  }

  /**
   * The assistant's `board_ack`. Without an id it answers the newest pending message. A message
   * may be acked again: the status row shows the last state.
   */
  ack(
    id: string | undefined,
    status: AckStatus,
    message: string,
  ): QuickMessage {
    const entry = id
      ? this.entries.find((candidate) => candidate.id === id)
      : this.entries.find((candidate) => candidate.status === "pending");
    if (!entry)
      throw new Error(
        id
          ? `No quick message ${id}. Recent ones: ${this.entries.map((e) => e.id).join(", ") || "none"}`
          : "No quick message is waiting for an ack",
      );
    this.settle(entry, status, message, false);
    return { ...entry };
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const id of [...this.waiters.keys()]) this.wake(id);
  }

  private find(id: string): QuickMessage {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`No quick message ${id}`);
    return entry;
  }

  private settle(
    entry: QuickMessage,
    status: AckStatus,
    message: string,
    inferred: boolean,
  ) {
    entry.status = status;
    entry.message = oneLine(message) || status;
    entry.ackedAt = this.stamp();
    entry.inferred = inferred;
    this.wake(entry.id);
  }

  private wake(id: string): void {
    const listeners = this.waiters.get(id);
    this.waiters.delete(id);
    for (const listener of listeners ?? []) listener();
  }

  private waitFor(id: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.disposed) return resolve();
      const listeners = this.waiters.get(id) ?? new Set();
      this.waiters.set(id, listeners);
      const done = () => {
        clearTimeout(timer);
        this.timers.delete(timer);
        listeners.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.timers.add(timer);
      listeners.add(done);
    });
  }

  /**
   * Until the message is acked: an errored or missing chat settles it as an error, and a turn that
   * ended without `board_ack` settles it from the reply. Nothing here interrupts the agent.
   */
  private watch(
    entry: QuickMessage,
    agentId: string,
    before: string | null,
  ): void {
    const pollMs = this.deps.pollMs ?? 2_000;
    const startGraceMs = this.deps.startGraceMs ?? 10_000;
    const watchMs = this.deps.watchMs ?? 30 * 60_000;
    const started = this.now();
    let sawRunning = false;
    const tick = async () => {
      if (this.disposed || entry.status !== "pending") return;
      try {
        const activity = await this.deps.activity(agentId);
        if (entry.status !== "pending") return;
        if (activity === null)
          return this.settle(
            entry,
            "error",
            "The assistant chat is gone.",
            false,
          );
        if (activity === "error")
          return this.settle(
            entry,
            "error",
            "The assistant chat stopped with an error.",
            false,
          );
        if (activity === "running" || activity === "waiting") sawRunning = true;
        else if (sawRunning || this.now() - started >= startGraceMs) {
          const reply = await this.deps.lastReply(agentId);
          if (entry.status !== "pending") return;
          if (reply && reply !== before) {
            const classified = classifyReply(reply);
            return this.settle(
              entry,
              classified.status,
              classified.message,
              true,
            );
          }
        }
      } catch (error) {
        console.error("Quick message watch failed:", reason(error));
      }
      if (this.now() - started < watchMs) this.schedule(tick, pollMs);
    };
    this.schedule(tick, pollMs);
  }

  private schedule(run: () => Promise<void>, ms: number): void {
    if (this.disposed) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void run();
    }, ms);
    this.timers.add(timer);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
