import { describe, expect, it } from "vitest";
import { getIdleLabelWrites, selectOpenAgentIds } from "./idle-open-tab-labels";

const LABEL = "paseo.idle-open-tab.client";
const agent = (labels: Record<string, string> = {}, archived = false) => ({
  labels,
  archivedAt: archived ? new Date() : null,
});

describe("selectOpenAgentIds", () => {
  const deskTabs = [{ serverId: "home", agentId: "desk-agent" }];
  const layoutTabs = [
    { serverId: "home", agentId: "layout-agent" },
    { serverId: "work", agentId: "other" },
  ];

  it("counts only Desk tabs in Tasks mode", () => {
    const open = selectOpenAgentIds({ tasksMode: true, deskTabs, layoutTabs });
    expect([...open.keys()]).toEqual(["home"]);
    expect([...open.get("home")!]).toEqual(["desk-agent"]);
  });

  it("counts only layout tabs in normal mode, grouped by server", () => {
    const open = selectOpenAgentIds({ tasksMode: false, deskTabs, layoutTabs });
    expect([...open.get("home")!]).toEqual(["layout-agent"]);
    expect([...open.get("work")!]).toEqual(["other"]);
  });
});

describe("getIdleLabelWrites", () => {
  it("writes true for an open agent that is not marked", () => {
    const writes = getIdleLabelWrites({
      label: LABEL,
      openAgentIds: new Set(["a"]),
      agents: new Map([["a", agent()]]),
    });
    expect(writes).toEqual([{ agentId: "a", value: "true" }]);
  });

  it("writes false only for a marked agent that closed", () => {
    const writes = getIdleLabelWrites({
      label: LABEL,
      openAgentIds: new Set(),
      agents: new Map([
        ["marked", agent({ [LABEL]: "true" })],
        ["never", agent()],
        ["already-false", agent({ [LABEL]: "false" })],
      ]),
    });
    expect(writes).toEqual([{ agentId: "marked", value: "false" }]);
  });

  it("skips archived agents and agents already in the desired state", () => {
    const writes = getIdleLabelWrites({
      label: LABEL,
      openAgentIds: new Set(["open", "archived"]),
      agents: new Map([
        ["open", agent({ [LABEL]: "true" })],
        ["archived", agent({}, true)],
      ]),
    });
    expect(writes).toEqual([]);
  });

  it("skips writes already in flight", () => {
    const writes = getIdleLabelWrites({
      label: LABEL,
      openAgentIds: new Set(["a"]),
      agents: new Map([["a", agent()]]),
      pending: new Set(["a:true"]),
    });
    expect(writes).toEqual([]);
  });
});
