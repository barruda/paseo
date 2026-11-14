import type { AgentSessionConfig } from "@getpaseo/protocol/agent-types";
import type { VoiceRuntime, VoiceRuntimeSnapshot } from "@/voice/voice-runtime";

export interface VoiceSessionTarget {
  serverId: string;
  agentId: string;
  workspaceId: string | null;
}

export interface SidebarVoiceSnapshot {
  operation: "idle" | "starting" | "stopping" | "interrupting";
  target: VoiceSessionTarget | null;
  error: string | null;
}

export interface SidebarVoicePorts {
  resolveAgent(serverId: string, config: AgentSessionConfig): Promise<VoiceSessionTarget>;
  voice: Pick<VoiceRuntime, "getSnapshot" | "startVoice" | "stopVoice">;
  cancelAgent(target: VoiceSessionTarget): Promise<unknown>;
}

export function ownsSidebarVoice(
  target: VoiceSessionTarget | null,
  voice: VoiceRuntimeSnapshot,
): boolean {
  return (
    target !== null &&
    target.serverId === voice.activeServerId &&
    target.agentId === voice.activeAgentId &&
    voice.phase !== "disabled"
  );
}

// CUSTOM(sidebar-voice): session ownership outlives sidebar mounts and workspace navigation.
export function createSidebarVoiceSession(ports: SidebarVoicePorts) {
  let snapshot: SidebarVoiceSnapshot = { operation: "idle", target: null, error: null };
  const listeners = new Set<() => void>();
  let operationId = 0;
  function publish(next: SidebarVoiceSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function fail(error: unknown) {
    publish({
      ...snapshot,
      operation: "idle",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  async function stop(target: VoiceSessionTarget, interrupt: boolean) {
    const currentOperation = ++operationId;
    publish({ ...snapshot, operation: interrupt ? "interrupting" : "stopping", error: null });
    try {
      const operations: Promise<unknown>[] = [];
      const voice = ports.voice.getSnapshot();
      if (ownsSidebarVoice(target, voice) && voice.phase !== "stopping")
        operations.push(ports.voice.stopVoice());
      if (interrupt) operations.push(ports.cancelAgent(target));
      const outcomes = await Promise.allSettled(operations);
      const failure = outcomes.find((outcome) => outcome.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      if (operationId === currentOperation) publish({ ...snapshot, operation: "idle" });
    } catch (error) {
      if (operationId === currentOperation) fail(error);
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async start(serverId: string, config: AgentSessionConfig) {
      if (snapshot.operation !== "idle" || ports.voice.getSnapshot().isVoiceSwitching) return;
      publish({ ...snapshot, operation: "starting", error: null });
      try {
        const target = await ports.resolveAgent(serverId, config);
        publish({ ...snapshot, target });
        await ports.voice.startVoice(target.serverId, target.agentId);
        publish({ ...snapshot, operation: "idle" });
      } catch (error) {
        fail(error);
      }
    },
    // CUSTOM(voice-exit): Esc only ever leaves voice mode. While the exit is still stopping, a
    // repeated Esc is swallowed here instead of reaching the agent's interrupt.
    exit(): boolean {
      const target = snapshot.target;
      if (!target) return false;
      if (snapshot.operation === "stopping") return true;
      if (!ownsSidebarVoice(target, ports.voice.getSnapshot()) || snapshot.operation !== "idle")
        return false;
      void stop(target, false);
      return true;
    },
    async stopAndInterrupt() {
      if (!snapshot.target) return;
      await stop(snapshot.target, true);
    },
  };
}
