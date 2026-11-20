import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { expect, it } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { PROJECT_LETTER_COLOR, ProjectIcon } from "../client/ProjectIcon";
import { projectAccentColor, projectLetterFill } from "../client/colors";
import {
  accentFromDominantColor,
  identityAccent,
} from "../shared/project-color";
import type { ProjectIconData } from "../shared/model";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Theme = PluginSurfaceProps["theme"];
type Rendered = TestRenderer.ReactTestRenderer;

interface JsonNode {
  type: string;
  props: Record<string, unknown>;
  children: Array<JsonNode | string> | null;
}

function theme(surface0: string): Theme {
  return { colors: { surface0 } } as unknown as Theme;
}

const light = theme("#ffffff");
const dark = theme("#0b0d10");
const accent = accentFromDominantColor("#1a90e7")!;
const letterFill = identityAccent("remote:org/dreammmo").light;
const png: ProjectIconData = { data: "AAAA", mimeType: "image/png" };

function render(props: Parameters<typeof ProjectIcon>[0]): Rendered {
  let renderer!: Rendered;
  act(() => {
    renderer = TestRenderer.create(createElement(ProjectIcon, props));
  });
  return renderer;
}

function tree(renderer: Rendered): JsonNode | null {
  const json = renderer.toJSON();
  return json && !Array.isArray(json) ? (json as JsonNode) : null;
}

function findAll(node: JsonNode | null, type: string): JsonNode[] {
  if (!node) return [];
  const found = node.type === type ? [node] : [];
  for (const child of node.children ?? []) {
    if (typeof child !== "string") found.push(...findAll(child, type));
  }
  return found;
}

function first(node: JsonNode | null, type: string): JsonNode {
  const found = findAll(node, type)[0];
  if (!found) throw new Error(`no ${type} node`);
  return found;
}

function textOf(node: JsonNode): string {
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

function flatStyle(node: JsonNode): Record<string, unknown> {
  const style = node.props.style;
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.filter(Boolean));
  }
  return (style as Record<string, unknown>) ?? {};
}

it("shows the project image with the app's cover fit, even without a name", () => {
  const renderer = render({
    name: "",
    color: accent.dark,
    fillColor: letterFill,
    icon: png,
  });
  const images = findAll(tree(renderer), "Image");
  expect(images).toHaveLength(1);
  expect(images[0]!.props.resizeMode).toBe("cover");
  expect(images[0]!.props.source).toEqual({
    uri: "data:image/png;base64,AAAA",
  });
  expect(findAll(tree(renderer), "Text")).toHaveLength(0);
});

it("draws the app's letter on the identity fill, in white", () => {
  const renderer = render({
    name: "DreamMMO",
    color: accent.dark,
    fillColor: letterFill,
    icon: null,
  });
  const root = tree(renderer);
  expect(textOf(first(root, "Text"))).toBe("D");
  expect(flatStyle(first(root, "Text")).color).toBe(PROJECT_LETTER_COLOR);
  expect(PROJECT_LETTER_COLOR).toBe("#ffffff");
  expect(flatStyle(first(root, "View")).backgroundColor).toBe(letterFill);
});

it("goes back to the letter when the image fails", () => {
  const renderer = render({
    name: "DreamMMO",
    color: accent.dark,
    fillColor: letterFill,
    icon: png,
  });
  const image = first(tree(renderer), "Image");
  act(() => {
    (image.props.onError as () => void)();
  });
  const root = tree(renderer);
  expect(findAll(root, "Image")).toHaveLength(0);
  expect(first(root, "Text")).toBeTruthy();
  expect(textOf(first(root, "Text"))).toBe("D");
  expect(flatStyle(first(root, "View")).backgroundColor).toBe(letterFill);
});

it("paints the same identity fill and white letter in the light and dark themes", () => {
  const fill = projectLetterFill(letterFill, accent, "dreammmo");
  // The accent still moves between themes for borders and chips...
  expect(projectAccentColor(accent, "dreammmo", light)).toBe(accent.light);
  expect(projectAccentColor(accent, "dreammmo", dark)).toBe(accent.dark);
  // ...but the letter box keeps the app's identity fill in both, even when the accent came
  // from an image instead of the letter.
  expect(fill).toBe(letterFill);
  expect(fill).not.toBe(accent.light);
  for (const current of [light, dark]) {
    const renderer = render({
      name: "DreamMMO",
      color: projectAccentColor(accent, "dreammmo", current),
      fillColor: fill,
      icon: null,
    });
    const root = tree(renderer);
    expect(flatStyle(first(root, "View")).backgroundColor).toBe(letterFill);
    expect(flatStyle(first(root, "Text")).color).toBe("#ffffff");
  }
});

it("renders nothing when there is no image and no initial", () => {
  const renderer = render({
    name: "   ",
    color: accent.dark,
    fillColor: letterFill,
    icon: null,
  });
  expect(renderer.toJSON()).toBeNull();
});
