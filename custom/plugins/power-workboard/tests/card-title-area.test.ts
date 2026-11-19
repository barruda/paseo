import { expect, it } from "vitest";
import { splitTitleArea } from "../client/board-utils";

it("a short area before the colon becomes the label and the rest the title", () => {
  expect(
    splitTitleArea("Power Workboard: Assistant reports the checkpoint"),
  ).toEqual({
    area: "Power Workboard",
    title: "Assistant reports the checkpoint",
  });
  expect(splitTitleArea("Assets-board: thumbnails load lazily")).toEqual({
    area: "Assets-board",
    title: "thumbnails load lazily",
  });
  expect(splitTitleArea("  Power Workspace:  tabs  ")).toEqual({
    area: "Power Workspace",
    title: "tabs",
  });
});

it("a title without a colon stays as it is", () => {
  expect(splitTitleArea("Fix the board scroll")).toEqual({
    area: null,
    title: "Fix the board scroll",
  });
});

it("a colon in the middle of a long sentence is not an area", () => {
  expect(
    splitTitleArea(
      "When the user clicks the save button twice: nothing happens",
    ),
  ).toEqual({
    area: null,
    title: "When the user clicks the save button twice: nothing happens",
  });
  expect(splitTitleArea("It broke. Then this: crash")).toEqual({
    area: null,
    title: "It broke. Then this: crash",
  });
});

it("URLs and times with a colon are not an area", () => {
  expect(splitTitleArea("https://paseo.sh: docs are stale")).toEqual({
    area: null,
    title: "https://paseo.sh: docs are stale",
  });
  expect(splitTitleArea("Alarm at 10:30: fire twice")).toEqual({
    area: null,
    title: "Alarm at 10:30: fire twice",
  });
  expect(splitTitleArea("Open localhost:6767 in the browser")).toEqual({
    area: null,
    title: "Open localhost:6767 in the browser",
  });
});

it("an empty title, an empty area or an empty rest show the title as it is", () => {
  expect(splitTitleArea("")).toEqual({ area: null, title: "" });
  expect(splitTitleArea(": nothing before")).toEqual({
    area: null,
    title: ": nothing before",
  });
  expect(splitTitleArea("Power Workboard:")).toEqual({
    area: null,
    title: "Power Workboard:",
  });
});
