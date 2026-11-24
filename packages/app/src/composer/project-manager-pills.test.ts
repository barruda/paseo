import { describe, expect, it } from "vitest";
import { layoutAboveRow } from "./project-manager-pills";

const ORDERED = [
  "subagents",
  "plugin:tldr:tldr",
  "commit",
  "rename",
  "plugin:vitals:pressure",
  "diff",
  "plugin:power-workboard:restart-chat",
  "reading",
];

describe("layoutAboveRow", () => {
  it("keeps every pill for a regular agent, restart and reading on the right", () => {
    expect(layoutAboveRow(ORDERED, false)).toEqual({
      row: ["subagents", "plugin:tldr:tldr", "commit", "rename", "plugin:vitals:pressure", "diff"],
      right: ["plugin:power-workboard:restart-chat", "reading"],
    });
  });

  it("drops commit, rename and the disk warning for the Project Manager and leads with Restart chat", () => {
    expect(layoutAboveRow(ORDERED, true)).toEqual({
      row: ["plugin:power-workboard:restart-chat", "subagents", "plugin:tldr:tldr", "diff"],
      right: ["reading"],
    });
  });

  it("leads with Restart chat wherever the saved order puts it", () => {
    const saved = ["diff", "reading", "commit", "plugin:power-workboard:restart-chat"];
    expect(layoutAboveRow(saved, true)).toEqual({
      row: ["plugin:power-workboard:restart-chat", "diff"],
      right: ["reading"],
    });
  });

  it("has no Restart chat while the plugin pill is absent", () => {
    expect(layoutAboveRow(["commit", "diff", "reading"], true)).toEqual({
      row: ["diff"],
      right: ["reading"],
    });
  });
});
