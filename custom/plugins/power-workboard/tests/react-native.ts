import { createElement } from "react";

export const Animated = { Value: class {}, timing() {} };
export const PanResponder = { create() {} };
export const Platform = { OS: "native" as "native" | "web" };
export const Pressable = (props: Record<string, unknown>) =>
  createElement("Pressable", props);
export const ScrollView = (props: Record<string, unknown>) =>
  createElement("ScrollView", props);
export const StyleSheet = { create: <T>(styles: T) => styles };
export const Text = (props: Record<string, unknown>) =>
  createElement("Text", props);
export const View = (props: Record<string, unknown>) =>
  createElement("View", props);
export const Image = (props: Record<string, unknown>) =>
  createElement("Image", props);
