import { describe, expect, test } from "vitest";

import type { AgentMode } from "./agent-sdk-types.js";
import {
  isUnattendedAgentConfig,
  resolveUnattendedCreateConfig,
  sanitizeRequestedMode,
} from "./unattended-mode.js";

const claudeModes: AgentMode[] = [
  { id: "plan", label: "Plan" },
  { id: "default", label: "Always Ask" },
  { id: "bypassPermissions", label: "Bypass" },
];
const codexModes: AgentMode[] = [
  { id: "auto", label: "Default Permissions" },
  { id: "full-access", label: "Full Access" },
];
const openCodeModes: AgentMode[] = [
  { id: "build", label: "Build" },
  { id: "plan", label: "Plan" },
];

describe("unattended create-config resolution", () => {
  test("Claude uses bypassPermissions even when another valid mode was requested", () => {
    expect(
      resolveUnattendedCreateConfig({
        provider: "claude",
        modeId: "plan",
        availableModes: claudeModes,
      }),
    ).toEqual({ modeId: "bypassPermissions", featureValues: undefined });
  });

  test("Codex uses its full-access mode", () => {
    expect(
      resolveUnattendedCreateConfig({
        provider: "codex",
        modeId: "auto",
        availableModes: codexModes,
      }),
    ).toEqual({ modeId: "full-access", featureValues: undefined });
  });

  test("OpenCode uses auto_accept and a mode that exists in the user's config", () => {
    expect(
      resolveUnattendedCreateConfig({
        provider: "opencode",
        modeId: "build",
        availableModes: openCodeModes,
      }),
    ).toEqual({
      modeId: "build",
      featureValues: { auto_accept: true },
    });
  });

  test("OpenCode drops a mode from another provider and lets OpenCode pick its default", () => {
    expect(
      resolveUnattendedCreateConfig({
        provider: "opencode",
        modeId: "bypassPermissions",
        availableModes: openCodeModes,
      }),
    ).toEqual({
      modeId: undefined,
      featureValues: { auto_accept: true },
    });
  });

  test("a provider without a marked mode falls back to a heuristic on id and label", () => {
    const modes: AgentMode[] = [
      { id: "ask", label: "Always Ask" },
      { id: "yolo", label: "Yolo" },
    ];
    expect(
      resolveUnattendedCreateConfig({
        provider: "future-agent",
        modeId: "ask",
        availableModes: modes,
      }),
    ).toEqual({ modeId: "yolo", featureValues: undefined });
    expect(
      resolveUnattendedCreateConfig({
        provider: "future-agent",
        modeId: "custom",
        availableModes: [
          { id: "custom", label: "Never ask" },
          { id: "ask", label: "Always Ask" },
        ],
      }),
    ).toEqual({ modeId: "custom", featureValues: undefined });
  });

  test("a provider with no full-access candidate keeps a requested mode that exists", () => {
    const modes: AgentMode[] = [{ id: "custom", label: "Custom" }];
    expect(
      resolveUnattendedCreateConfig({
        provider: "future-agent",
        modeId: "custom",
        availableModes: modes,
      }),
    ).toEqual({ modeId: "custom", featureValues: undefined });
  });
});

describe("re-resolution after a model or provider change", () => {
  test("a Claude bypass config moved to OpenCode becomes auto_accept with no stale mode", () => {
    expect(
      resolveUnattendedCreateConfig({
        provider: "opencode",
        modeId: "bypassPermissions",
        availableModes: openCodeModes,
        featureValues: undefined,
      }),
    ).toEqual({
      modeId: undefined,
      featureValues: { auto_accept: true },
    });
  });

  test("an OpenCode resume drops a Claude bypass mode even before its catalog loads", () => {
    expect(
      resolveUnattendedCreateConfig({
        provider: "opencode",
        modeId: "bypassPermissions",
        availableModes: undefined,
        featureValues: undefined,
      }),
    ).toEqual({
      modeId: undefined,
      featureValues: { auto_accept: true },
    });
  });

  test("a mode that disappeared from the provider is replaced by the provider's full-access mode", () => {
    expect(
      resolveUnattendedCreateConfig({
        provider: "claude",
        modeId: "old-bypass",
        availableModes: claudeModes,
      }),
    ).toEqual({ modeId: "bypassPermissions", featureValues: undefined });
  });
});

describe("unattended detection", () => {
  test("recognizes known modes, auto_accept and a heuristic mode id", () => {
    expect(isUnattendedAgentConfig({ provider: "claude", modeId: "bypassPermissions" })).toBe(true);
    expect(
      isUnattendedAgentConfig({
        provider: "opencode",
        modeId: undefined,
        featureValues: { auto_accept: true },
      }),
    ).toBe(true);
    expect(isUnattendedAgentConfig({ provider: "future-agent", modeId: "yolo" })).toBe(true);
    expect(isUnattendedAgentConfig({ provider: "claude", modeId: "plan" })).toBe(false);
  });
});

describe("sanitizeRequestedMode", () => {
  test("keeps a provider's own unattended mode and drops unknown modes", () => {
    expect(
      sanitizeRequestedMode({
        provider: "claude",
        modeId: "bypassPermissions",
        availableModes: [],
      }),
    ).toBe("bypassPermissions");
    expect(
      sanitizeRequestedMode({
        provider: "opencode",
        modeId: "bypassPermissions",
        availableModes: openCodeModes,
      }),
    ).toBeUndefined();
    expect(
      sanitizeRequestedMode({
        provider: "opencode",
        modeId: "build",
        availableModes: openCodeModes,
      }),
    ).toBe("build");
  });
});
