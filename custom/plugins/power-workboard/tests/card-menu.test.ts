import { expect, it } from "vitest";
import { canArchiveTask, cardMenuItems } from "../client/card-menu";
import { strings } from "../client/strings";
import {
  cardSchema,
  groupSchema,
  newTask,
  settingsSchema,
} from "../shared/model";

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

// CUSTOM(archive-task)
it("a bound Done or Canceled card offers Archive task; drafts and open cards don't", () => {
  const groups = [
    ...settingsSchema.parse({}).groups,
    groupSchema.parse({
      id: "canceled",
      kind: "canceled",
      label: "pwb:canceled",
    }),
  ];
  expect(
    canArchiveTask(card({ workspaceId: "w1", stage: "done" }), groups),
  ).toBe(true);
  expect(
    canArchiveTask(card({ workspaceId: "w1", stage: "todo" }), groups),
  ).toBe(false);
  expect(
    canArchiveTask(card({ workspaceId: "w1", stage: "canceled" }), groups),
  ).toBe(true);
  expect(canArchiveTask(card({ stage: "canceled" }), groups)).toBe(false);
  const calls: string[] = [];
  const menu = (disabled: boolean) =>
    cardMenuItems({
      card: card({ workspaceId: "w1", stage: "done" }),
      agentId: null,
      t,
      disabled,
      onOpenPanel: () => {},
      onOpen: () => {},
      onOpenAgent: () => {},
      onEdit: () => {},
      onStatus: () => {},
      onArchiveTask: () => calls.push("archive"),
    });
  const item = menu(false).at(-1)!;
  expect(item).toMatchObject({ id: "archive-task", label: "Archive task" });
  item.onPress();
  expect(calls).toEqual(["archive"]);
  expect(menu(true).some((entry) => entry.id === "archive-task")).toBe(false);
});
