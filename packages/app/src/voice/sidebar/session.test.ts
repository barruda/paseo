import { createKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher";
import { dispatchVoiceEscape } from "@/keyboard/voice-escape";
import { expect, it } from "vitest";
import type { VoiceRuntimeSnapshot } from "@/voice/voice-runtime";
import { createSidebarVoiceSession, type VoiceSessionTarget } from "./session";

const target: VoiceSessionTarget = {
  serverId: "host",
  agentId: "voice-agent",
  workspaceId: "voice-workspace",
};
const config = { provider: "codex", cwd: "~" };
const disabled: VoiceRuntimeSnapshot = {
  phase: "disabled",
  activeServerId: null,
  activeAgentId: null,
  isVoiceMode: false,
  isVoiceSwitching: false,
  isMuted: false,
  isReplyMuted: false,
};
function setup() {
  let voice = disabled;
  let now = 100;
  const calls: string[] = [];
  let failure: Error | null = null;
  let pendingStop: Promise<void> = Promise.resolve();
  const session = createSidebarVoiceSession({
    now: () => now,
    resolveAgent: async () => {
      calls.push("resolve");
      if (failure) throw failure;
      return target;
    },
    voice: {
      getSnapshot: () => voice,
      startVoice: async (host, agent) => {
        calls.push(`start:${host}:${agent}`);
        voice = {
          ...disabled,
          phase: "listening",
          isVoiceMode: true,
          activeServerId: host,
          activeAgentId: agent,
        };
      },
      stopVoice: async () => {
        calls.push("stop");
        voice = { ...voice, phase: "stopping", isVoiceSwitching: true };
        await pendingStop;
        voice = disabled;
      },
    },
    cancelAgent: async (value) => {
      calls.push(`cancel:${value.agentId}`);
    },
  });
  return {
    session,
    calls,
    getVoice: () => voice,
    setVoice: (value: VoiceRuntimeSnapshot) => {
      voice = value;
    },
    advance: () => {
      now += 1501;
    },
    fail: (value: Error | null) => {
      failure = value;
    },
    holdStop: (value: Promise<void>) => {
      pendingStop = value;
    },
  };
}

it("keeps the independent voice session alive when sidebar subscribers unmount", async () => {
  const f = setup();
  const unsubscribe = f.session.subscribe(() => {});
  await f.session.start("host", config);
  unsubscribe();
  expect(f.getVoice()).toMatchObject({ phase: "listening", activeAgentId: "voice-agent" });
  expect(f.session.getSnapshot().target).toEqual(target);
  expect(f.calls).toEqual(["resolve", "start:host:voice-agent"]);
});

it("first Escape exits only voice; the second interrupts its agent while exit is pending", async () => {
  const f = setup();
  let finishStop = () => {};
  f.holdStop(
    new Promise<void>((resolve) => {
      finishStop = resolve;
    }),
  );
  await f.session.start("host", config);
  expect(f.session.exit()).toBe(true);
  expect(f.calls).toEqual(["resolve", "start:host:voice-agent", "stop"]);
  expect(f.session.interruptAfterExit()).toBe(true);
  expect(f.calls).toEqual(["resolve", "start:host:voice-agent", "stop", "cancel:voice-agent"]);
  finishStop();
});

it("does not steal later interrupts or an unrelated conversation's voice controls", async () => {
  const f = setup();
  await f.session.start("host", config);
  f.session.exit();
  f.advance();
  expect(f.session.interruptAfterExit()).toBe(false);
  f.setVoice({
    ...disabled,
    phase: "listening",
    activeServerId: "host",
    activeAgentId: "other-agent",
    isVoiceMode: true,
  });
  expect(f.session.exit()).toBe(false);
});

it("deduplicates repeated start clicks", async () => {
  const f = setup();
  await Promise.all([f.session.start("host", config), f.session.start("host", config)]);
  expect(f.calls).toEqual(["resolve", "start:host:voice-agent"]);
});

it("keeps failure visible and allows retry", async () => {
  const f = setup();
  f.fail(new Error("Host disconnected"));
  await f.session.start("host", config);
  expect(f.session.getSnapshot()).toEqual({
    operation: "idle",
    target: null,
    error: "Host disconnected",
  });
  f.fail(null);
  await f.session.start("host", config);
  expect(f.session.getSnapshot()).toEqual({ operation: "idle", target, error: null });
});

it("the stop control exits and interrupts the dedicated agent", async () => {
  const f = setup();
  await f.session.start("host", config);
  await f.session.stopAndInterrupt();
  expect(f.getVoice().phase).toBe("disabled");
  expect(f.calls).toEqual(["resolve", "start:host:voice-agent", "stop", "cancel:voice-agent"]);
});

it("both Escapes reach voice before the current conversation's interrupt handler", async () => {
  const f = setup();
  await f.session.start("host", config);
  const dispatcher = createKeyboardActionDispatcher();
  dispatcher.registerHandler({
    handlerId: "current-chat",
    actions: ["agent.interrupt", "message-input.voice-exit"],
    priority: 1,
    enabled: true,
    handle: () => {
      throw new Error("Must not interrupt the current chat");
    },
  });
  dispatcher.registerHandler({
    handlerId: "global-voice",
    actions: ["message-input.voice-exit"],
    priority: 10000,
    enabled: true,
    handle: () => f.session.exit() || f.session.interruptAfterExit(),
  });
  const key = {
    key: "Escape",
    code: "Escape",
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  };
  expect(dispatchVoiceEscape(key, (action) => dispatcher.dispatch(action))).toBe(true);
  expect(dispatchVoiceEscape(key, (action) => dispatcher.dispatch(action))).toBe(true);
  expect(f.calls).toEqual(["resolve", "start:host:voice-agent", "stop", "cancel:voice-agent"]);
});
