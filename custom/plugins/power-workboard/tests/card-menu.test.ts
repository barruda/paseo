import { expect, it } from "vitest";
import { cardMenuItems } from "../client/card-menu";
import { strings } from "../client/strings";
import { cardSchema, newTask } from "../shared/model";

const t = strings("en");
const card = (over: Record<string, unknown> = {}) =>
  cardSchema.parse({
    ...newTask("t1", "Task", "2026-09-23T00:00:00Z", "todo"),
    stage: "todo",
    labels: [],
    managedLabels: [],
    changeRequest: null,
    changeRequestUnavailable: false,
    activity: "idle",
    pinState: "none",
    dueAt: null,
    agents: [],
    ...over,
  });

it("a card with a workspace and an agent offers the panel first and every usual action", () => {
  const calls: string[] = [];
  const items = cardMenuItems({
    card: card({ workspaceId: "w1" }),
    agentId: "a1",
    t,
    disabled: false,
    onOpenPanel: () => calls.push("panel"),
    onOpen: () => calls.push("workspace"),
    onOpenAgent: (id) => calls.push(`agent:${id}`),
    onEdit: () => calls.push("edit"),
    onStatus: () => calls.push("status"),
  });
  expect(items.map((item) => item.id)).toEqual([
    "panel",
    "workspace",
    "agent",
    "edit",
    "status",
  ]);
  expect(items[0].label).toBe("Open in panel");
  items[0].onPress();
  items[2].onPress();
  expect(calls).toEqual(["panel", "agent:a1"]);
});

it("a disabled draft keeps only the panel and edit entries", () => {
  const items = cardMenuItems({
    card: card(),
    agentId: null,
    t,
    disabled: true,
    onOpenPanel: () => {},
    onOpen: () => {},
    onOpenAgent: () => {},
    onEdit: () => {},
    onStatus: () => {},
  });
  expect(items.map((item) => item.id)).toEqual(["panel", "edit"]);
});

// CUSTOM(delete-task)
it("Delete task is the last entry in every column, drawn as destructive", () => {
  const deleted: string[] = [];
  for (const over of [{}, { workspaceId: "w1", stage: "review" }]) {
    const items = cardMenuItems({
      card: card(over),
      agentId: null,
      t,
      disabled: true,
      onOpenPanel: () => {},
      onOpen: () => {},
      onOpenAgent: () => {},
      onEdit: () => {},
      onStatus: () => {},
      onDelete: () => deleted.push("t1"),
    });
    const last = items.at(-1)!;
    expect(last).toMatchObject({
      id: "delete",
      label: "Delete task",
      destructive: true,
    });
    last.onPress();
  }
  expect(deleted).toEqual(["t1", "t1"]);
});
