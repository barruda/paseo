// CUSTOM(unattended-automation)
import { expect, it } from "vitest";
import {
  fullAccessModeOf,
  isFeaturePermissionProvider,
  providerIdOf,
  runsUnattended,
} from "../shared/permission";

const run = (provider: string, modeId: string | null, autoAccept = true) =>
  runsUnattended({ provider, modeId, autoAccept });

it("reads the provider out of provider/model", () => {
  expect(providerIdOf("opencode/deepseek/deepseek-v4")).toBe("opencode");
  expect(providerIdOf("claude")).toBe("claude");
  expect(isFeaturePermissionProvider("opencode/x")).toBe(true);
  expect(isFeaturePermissionProvider("copilot/x")).toBe(false);
});

it("a mode provider runs unattended with an empty or full-access mode", () => {
  expect(run("claude/opus", null)).toBe(true);
  expect(run("claude/opus", "")).toBe(true);
  expect(run("claude/opus", "bypassPermissions")).toBe(true);
  expect(run("claude/opus", "default")).toBe(false);
  expect(run("claude/opus", "plan")).toBe(false);
  expect(run("codex/gpt", "full-access")).toBe(true);
  expect(run("codex/gpt", "auto-review")).toBe(false);
  expect(run("copilot/x", "allow-all")).toBe(true);
  // The mode of a mode provider wins over autoAccept.
  expect(run("claude/opus", "default", true)).toBe(false);
});

it("a feature provider follows autoAccept whatever the agent", () => {
  for (const mode of ["build", "plan", null]) {
    expect(run("opencode/deepseek/x", mode, true)).toBe(true);
    expect(run("opencode/deepseek/x", mode, false)).toBe(false);
  }
});

it("finds the full-access mode by colour tier, then by id or label", () => {
  expect(
    fullAccessModeOf([
      { id: "a", label: "Full tools" },
      { id: "b", label: "Risky", colorTier: "dangerous" },
    ])?.id,
  ).toBe("b");
  expect(
    fullAccessModeOf([
      { id: "default", label: "Default" },
      { id: "bypassPermissions", label: "Bypass" },
    ])?.id,
  ).toBe("bypassPermissions");
  expect(fullAccessModeOf([{ id: "x", label: "Allow all" }])?.id).toBe("x");
  expect(fullAccessModeOf([{ id: "build", label: "Build" }])).toBeUndefined();
});
