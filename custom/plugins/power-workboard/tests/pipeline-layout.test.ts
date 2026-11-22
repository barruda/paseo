// CUSTOM(factory): the pipeline editor's graph layout (docs/factory.md, ticket 8).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  edgeSegments,
  layoutPipeline,
  NODE_HEIGHT,
  NODE_WIDTH,
  pipelineNodeOrder,
  pipelineTransitions,
  type GraphEdge,
  type PipelineGraph,
} from "../client/pipeline-layout";
import {
  BUILTIN_PIPELINES,
  builtinPipelineFor,
} from "../shared/factory/builtin-pipelines";
import {
  pipelineFileSchema,
  type PipelineFile,
} from "../shared/factory/schema";
import { BUILTIN_FACTORY_DIR } from "../server/factory/builtin";

const edge = (graph: PipelineGraph, from: string, to: string): GraphEdge => {
  const found = graph.edges.find((e) => e.from === from && e.to === to);
  if (!found) throw new Error(`no edge ${from} -> ${to}`);
  return found;
};
const node = (graph: PipelineGraph, id: string) =>
  graph.nodes.find((n) => n.id === id)!;

/** No two nodes overlap. */
const overlapping = (graph: PipelineGraph) =>
  graph.nodes.some((a, i) =>
    graph.nodes.some(
      (b, j) =>
        i < j &&
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height,
    ),
  );

/** Every point of the drawing is inside it. */
const inside = (graph: PipelineGraph) =>
  graph.nodes.every(
    (n) =>
      n.x >= 0 &&
      n.y >= 0 &&
      n.x + n.width <= graph.width &&
      n.y + n.height <= graph.height,
  ) &&
  graph.edges.every((e) =>
    e.points.every(
      (p) => p.x >= 0 && p.y >= 0 && p.x <= graph.width && p.y <= graph.height,
    ),
  );

describe("built-in pipelines", () => {
  it.each(Object.keys(BUILTIN_PIPELINES))(
    "%s matches its YAML file and is valid",
    async (id) => {
      const text = await readFile(
        path.join(BUILTIN_FACTORY_DIR, "pipelines", `${id}.yaml`),
        "utf8",
      );
      const fromFile = pipelineFileSchema.parse(parse(text));
      expect(BUILTIN_PIPELINES[id as keyof typeof BUILTIN_PIPELINES]).toEqual(
        fromFile,
      );
    },
  );

  it("has a constant for every YAML file", async () => {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(path.join(BUILTIN_FACTORY_DIR, "pipelines"));
    expect(files.map((file) => file.replace(/\.yaml$/, "")).sort()).toEqual(
      Object.keys(BUILTIN_PIPELINES).sort(),
    );
  });

  it("maps the fresh-agent review policy to critical, the rest to default", () => {
    expect(builtinPipelineFor("fresh-agent")).toBe("critical");
    expect(builtinPipelineFor("self")).toBe("default");
  });
});

describe("pipelineTransitions and pipelineNodeOrder", () => {
  it("lists to, when and gate transitions in file order", () => {
    expect(pipelineTransitions(BUILTIN_PIPELINES.critical)).toEqual([
      {
        from: "triage",
        to: "spec",
        via: "when",
        label: "The ticket is large, ambiguous, or changes visible behavior.",
      },
      {
        from: "triage",
        to: "implement",
        via: "when",
        label: "The ticket is small and clear.",
      },
      { from: "spec", to: "implement", via: "gate", label: "Approve" },
      { from: "spec", to: "spec", via: "gate", label: "Request changes" },
      { from: "implement", to: "verify", via: "to" },
      {
        from: "verify",
        to: "review",
        via: "when",
        label: "Every check passed, with evidence.",
      },
      {
        from: "verify",
        to: "implement",
        via: "when",
        label: "A check failed.",
      },
      {
        from: "review",
        to: "deliver",
        via: "when",
        label: "No blocking findings.",
      },
      {
        from: "review",
        to: "implement",
        via: "when",
        label: "Blocking findings remain.",
      },
    ]);
  });

  it("orders stages from start, then unreachable ones, then the built-ins named", () => {
    const pipeline: PipelineFile = {
      start: "b",
      stages: {
        a: { role: "implement", to: "cancel" },
        b: { role: "implement", to: "c" },
        c: { role: "review", to: "end" },
      },
    };
    expect(pipelineNodeOrder(pipeline)).toEqual([
      "b",
      "c",
      "a",
      "end",
      "cancel",
    ]);
    expect(pipelineNodeOrder(BUILTIN_PIPELINES.critical)).toEqual([
      "triage",
      "spec",
      "implement",
      "verify",
      "review",
      "deliver",
    ]);
  });
});

describe("layoutPipeline", () => {
  it("lays default out as a column with the review loop on the left", () => {
    const graph = layoutPipeline(BUILTIN_PIPELINES.default);
    expect(graph.nodes.map((n) => [n.id, n.kind, n.layer])).toEqual([
      ["implement", "stage", 0],
      ["review", "stage", 1],
      ["deliver", "builtin", 2],
    ]);
    const xs = new Set(graph.nodes.map((n) => n.x));
    expect(xs.size).toBe(1);
    expect(overlapping(graph)).toBe(false);
    expect(inside(graph)).toBe(true);

    const down = edge(graph, "implement", "review");
    expect(down.kind).toBe("next");
    expect(down.label).toBeNull();
    expect(down.arrow).toBe("down");
    expect(down.points).toEqual([
      {
        x: node(graph, "implement").x + NODE_WIDTH / 2,
        y: node(graph, "implement").y + NODE_HEIGHT,
      },
      {
        x: node(graph, "review").x + NODE_WIDTH / 2,
        y: node(graph, "review").y,
      },
    ]);

    const loop = edge(graph, "review", "implement");
    expect(loop.kind).toBe("back");
    expect(loop.arrow).toBe("right");
    // The lane runs left of the nodes, and the label sits left of the lane.
    expect(loop.points[1].x).toBeLessThan(node(graph, "review").x);
    expect(loop.label?.align).toBe("end");
    expect(loop.transitions.map((t) => t.label)).toEqual([
      "Blocking findings remain.",
    ]);
    expect(edge(graph, "review", "deliver").label?.align).toBe("center");
  });

  it("lays critical out with skip, back and self edges", () => {
    const graph = layoutPipeline(BUILTIN_PIPELINES.critical);
    expect(graph.nodes.map((n) => [n.id, n.layer])).toEqual([
      ["triage", 0],
      ["spec", 1],
      ["implement", 2],
      ["verify", 3],
      ["review", 4],
      ["deliver", 5],
    ]);
    expect(overlapping(graph)).toBe(false);
    expect(inside(graph)).toBe(true);
    const kinds = Object.fromEntries(
      graph.edges.map((e) => [`${e.from}->${e.to}`, e.kind]),
    );
    expect(kinds).toEqual({
      "triage->spec": "next",
      "triage->implement": "skip",
      "spec->implement": "next",
      "spec->spec": "self",
      "implement->verify": "next",
      "verify->review": "next",
      "verify->implement": "back",
      "review->deliver": "next",
      "review->implement": "back",
    });

    // The skip runs in a lane right of the nodes and enters implement from the right.
    const skip = edge(graph, "triage", "implement");
    const right = node(graph, "triage").x + NODE_WIDTH;
    expect(skip.points[1].x).toBeGreaterThan(right);
    expect(skip.arrow).toBe("left");

    // Back edges nest: the shorter span takes the inner lane.
    const short = edge(graph, "verify", "implement").points[1].x;
    const long = edge(graph, "review", "implement").points[1].x;
    expect(short).toBeGreaterThan(long);
    expect(short).toBeLessThan(node(graph, "verify").x);

    // The self loop leaves and re-enters the node's right side.
    const self = edge(graph, "spec", "spec");
    expect(self.points[0].x).toBe(node(graph, "spec").x + NODE_WIDTH);
    expect(self.points.at(-1)!.x).toBe(node(graph, "spec").x + NODE_WIDTH);
    expect(self.arrow).toBe("left");
    expect(self.label?.align).toBe("start");
  });

  it("puts parallel stages of one row side by side and routes to each", () => {
    const pipeline: PipelineFile = {
      start: "triage",
      stages: {
        triage: {
          role: "triage",
          to: [
            { stage: "a", when: "A." },
            { stage: "b", when: "B." },
          ],
        },
        a: { role: "implement", to: "deliver" },
        b: { role: "implement", to: "deliver" },
      },
    };
    const graph = layoutPipeline(pipeline);
    expect(node(graph, "a").y).toBe(node(graph, "b").y);
    expect(node(graph, "a").x).toBeLessThan(node(graph, "b").x);
    expect(overlapping(graph)).toBe(false);
    expect(inside(graph)).toBe(true);
    // triage is centered over the row, so each edge bends once to its target.
    const toA = edge(graph, "triage", "a");
    expect(toA.points).toHaveLength(4);
    expect(toA.points.at(-1)!.x).toBe(node(graph, "a").x + NODE_WIDTH / 2);
    expect(edge(graph, "a", "deliver").kind).toBe("next");
  });

  it("merges two gate options that lead to the same stage into one edge", () => {
    const pipeline: PipelineFile = {
      start: "spec",
      stages: {
        spec: {
          role: "spec",
          gate: {
            question: "Go?",
            options: [
              { id: "yes", label: "Yes", to: "end" },
              { id: "sure", label: "Sure", to: "end" },
            ],
          },
        },
      },
    };
    const graph = layoutPipeline(pipeline);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].transitions.map((t) => t.label)).toEqual([
      "Yes",
      "Sure",
    ]);
  });

  it("uses the saved layout when it places every node, keeping the edge kinds", () => {
    const pipeline: PipelineFile = {
      ...BUILTIN_PIPELINES.default,
      layout: {
        implement: { x: 0, y: 0 },
        review: { x: 300, y: 0 },
        deliver: { x: 600, y: 0 },
      },
    };
    const graph = layoutPipeline(pipeline);
    const [implement, review, deliver] = ["implement", "review", "deliver"].map(
      (id) => node(graph, id),
    );
    expect(implement.y).toBe(review.y);
    expect(review.x - implement.x).toBe(300);
    expect(deliver.x - review.x).toBe(300);
    expect(inside(graph)).toBe(true);
    // Same row: the forward edge can't go straight down, so it takes a lane.
    const forward = edge(graph, "implement", "review");
    expect(forward.kind).toBe("next");
    expect(forward.points).toHaveLength(4);
  });

  it("ignores a layout that misses a node", () => {
    const pipeline: PipelineFile = {
      ...BUILTIN_PIPELINES.default,
      layout: { implement: { x: 500, y: 500 } },
    };
    expect(layoutPipeline(pipeline)).toEqual(
      layoutPipeline(BUILTIN_PIPELINES.default),
    );
  });
});

describe("edgeSegments", () => {
  it("draws each orthogonal segment as a rectangle centered on the line", () => {
    expect(
      edgeSegments(
        [
          { x: 10, y: 10 },
          { x: 10, y: 50 },
          { x: 40, y: 50 },
        ],
        2,
      ),
    ).toEqual([
      { x: 9, y: 9, width: 2, height: 42 },
      { x: 9, y: 49, width: 32, height: 2 },
    ]);
  });
});
