// CUSTOM(factory): the pipeline editor's graph (docs/factory.md, "Pipeline editor"). Pure: it turns
// a pipeline into positioned nodes and orthogonal edges, so the view only draws rectangles. The
// plugin client has no SVG (only React, React Native and zod come from the host), and orthogonal
// segments are plain Views on every platform.
//
// Auto layout: stages in rows by longest path from `start`, back edges ignored. An edge to the
// next row goes straight down; an edge that skips rows runs in a lane on the right, a back edge in
// a lane on the left, inner lanes for the shorter spans. A `layout` that places every node wins
// over the rows; the edge kinds still come from the graph.
import { BUILTIN_STAGES, isBuiltinStage } from "../shared/factory/pipeline";
import type { PipelineFile } from "../shared/factory/schema";

export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 64;
export const ROW_GAP = 64;
export const COLUMN_GAP = 40;
export const LANE_GAP = 20;
export const MARGIN = 24;
export const SELF_LOOP = 18;
/** Room kept beside the outermost lane for its labels. */
export const LABEL_WIDTH = 140;

export interface Point {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  /** `builtin`: deliver, end or cancel, drawn as a terminal. */
  kind: "stage" | "builtin";
  /** Row of the auto layout. */
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How a transition is written: a single `to`, a `when` condition or a gate option. */
export type TransitionVia = "to" | "when" | "gate";

export interface Transition {
  from: string;
  to: string;
  via: TransitionVia;
  /** The `when` condition or the gate option's label; none for a single `to`. */
  label?: string;
}

/**
 * `next`: to a later row, drawn straight down when the target sits below. `skip`: to a later row
 * past others. `back`: to an earlier stage (a loop). `self`: to the same stage.
 */
export type EdgeKind = "next" | "skip" | "back" | "self";

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** The transitions this edge stands for, in file order (two gate options may share it). */
  transitions: Transition[];
  points: Point[];
  /** Direction of the last segment, for the arrowhead at the last point. */
  arrow: "up" | "down" | "left" | "right";
  /** Where the label chip goes; `start` puts its left edge at x, `end` its right edge. */
  label: { at: Point; align: "start" | "center" | "end" } | null;
}

export interface PipelineGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

/** Every transition of the pipeline, in file order: each stage's `to`, then its gate options. */
export function pipelineTransitions(pipeline: PipelineFile): Transition[] {
  const transitions: Transition[] = [];
  for (const [from, stage] of Object.entries(pipeline.stages)) {
    if (typeof stage.to === "string")
      transitions.push({ from, to: stage.to, via: "to" });
    else
      for (const option of stage.to ?? [])
        transitions.push({
          from,
          to: option.stage,
          via: "when",
          label: option.when,
        });
    for (const option of stage.gate?.options ?? [])
      if (option.to)
        transitions.push({
          from,
          to: option.to,
          via: "gate",
          label: option.label,
        });
  }
  return transitions;
}

/**
 * The node ids in display order: stages from `start` breadth first, then stages no transition
 * reaches, in file order, then the built-in stages the pipeline names. Phones list stages in it.
 */
export function pipelineNodeOrder(pipeline: PipelineFile): string[] {
  const transitions = pipelineTransitions(pipeline);
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (first: string) => {
    const queue = [first];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id) || !Object.hasOwn(pipeline.stages, id)) continue;
      seen.add(id);
      order.push(id);
      for (const transition of transitions)
        if (transition.from === id) queue.push(transition.to);
    }
  };
  visit(pipeline.start);
  for (const id of Object.keys(pipeline.stages)) visit(id);
  const named = new Set(transitions.map((transition) => transition.to));
  for (const id of BUILTIN_STAGES) if (named.has(id)) order.push(id);
  return order;
}

interface EdgeShape {
  from: string;
  to: string;
  transitions: Transition[];
}

/** Transitions grouped by their (from, to) pair, first occurrence first. */
function groupEdges(
  transitions: Transition[],
  nodes: Set<string>,
): EdgeShape[] {
  const edges = new Map<string, EdgeShape>();
  for (const transition of transitions) {
    // A transition to a stage the file lacks is a validation error; the graph leaves it out.
    if (!nodes.has(transition.to)) continue;
    const key = `${transition.from}\u0000${transition.to}`;
    const edge = edges.get(key);
    if (edge) edge.transitions.push(transition);
    else
      edges.set(key, {
        from: transition.from,
        to: transition.to,
        transitions: [transition],
      });
  }
  return [...edges.values()];
}

/** Edges that close a cycle in a depth-first walk from `start`, then from the other nodes. */
function backEdges(order: string[], edges: EdgeShape[]): Set<EdgeShape> {
  const back = new Set<EdgeShape>();
  const state = new Map<string, "open" | "done">();
  const walk = (id: string) => {
    state.set(id, "open");
    for (const edge of edges) {
      if (edge.from !== id || edge.from === edge.to) continue;
      const target = state.get(edge.to);
      if (target === "open") back.add(edge);
      else if (target === undefined) walk(edge.to);
    }
    state.set(id, "done");
  };
  for (const id of order) if (!state.has(id)) walk(id);
  return back;
}

/** Longest path from the roots over the forward edges. */
function layers(order: string[], forward: EdgeShape[]): Map<string, number> {
  const layer = new Map(order.map((id) => [id, 0]));
  // The forward edges form a DAG, so `order.length` relaxation passes settle every layer.
  for (let pass = 0; pass < order.length; pass++) {
    let changed = false;
    for (const edge of forward) {
      const next = layer.get(edge.from)! + 1;
      if (next > layer.get(edge.to)!) {
        layer.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

function arrowOf(points: Point[]): GraphEdge["arrow"] {
  const [a, b] = points.slice(-2);
  if (a.x === b.x) return b.y >= a.y ? "down" : "up";
  return b.x >= a.x ? "right" : "left";
}

export function layoutPipeline(pipeline: PipelineFile): PipelineGraph {
  const order = pipelineNodeOrder(pipeline);
  if (order.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };
  const nodeIds = new Set(order);
  const shapes = groupEdges(pipelineTransitions(pipeline), nodeIds);
  const back = backEdges(order, shapes);
  const forward = shapes.filter(
    (edge) => edge.from !== edge.to && !back.has(edge),
  );
  const layerOf = layers(order, forward);

  // Node boxes: the saved layout when it places every node, else rows.
  const saved = pipeline.layout ?? {};
  const manual = order.every((id) => Object.hasOwn(saved, id));
  const rows = new Map<number, string[]>();
  for (const id of order) {
    const layer = layerOf.get(id)!;
    rows.set(layer, [...(rows.get(layer) ?? []), id]);
  }
  const rowWidth = (count: number) =>
    count * NODE_WIDTH + (count - 1) * COLUMN_GAP;
  const widest = Math.max(
    ...[...rows.values()].map((row) => rowWidth(row.length)),
  );
  const boxes = new Map<string, GraphNode>();
  for (const id of order) {
    const layer = layerOf.get(id)!;
    const row = rows.get(layer)!;
    const auto = {
      x:
        (widest - rowWidth(row.length)) / 2 +
        row.indexOf(id) * (NODE_WIDTH + COLUMN_GAP),
      y: layer * (NODE_HEIGHT + ROW_GAP),
    };
    const at = manual ? saved[id] : auto;
    boxes.set(id, {
      id,
      kind: isBuiltinStage(id) ? "builtin" : "stage",
      layer,
      x: at.x,
      y: at.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  }

  const kindOf = (edge: EdgeShape): EdgeKind => {
    if (edge.from === edge.to) return "self";
    if (back.has(edge)) return "back";
    return layerOf.get(edge.to)! - layerOf.get(edge.from)! === 1
      ? "next"
      : "skip";
  };
  const direct = (edge: EdgeShape) => {
    const source = boxes.get(edge.from)!;
    return (
      kindOf(edge) === "next" &&
      boxes.get(edge.to)!.y >= source.y + source.height
    );
  };

  // Lanes: back edges on the left, other routed edges on the right; shorter spans inside.
  const span = (edge: EdgeShape) =>
    Math.abs(layerOf.get(edge.to)! - layerOf.get(edge.from)!);
  const routed = shapes.filter(
    (edge) => kindOf(edge) !== "self" && !direct(edge),
  );
  const laneSide = (edge: EdgeShape) =>
    kindOf(edge) === "back" ? "left" : "right";
  const lanes = new Map<EdgeShape, number>();
  for (const side of ["left", "right"] as const) {
    const onSide = routed
      .filter((edge) => laneSide(edge) === side)
      .sort((a, b) => span(a) - span(b));
    onSide.forEach((edge, index) => lanes.set(edge, index));
  }
  const nodes = [...boxes.values()];
  const left = Math.min(...nodes.map((node) => node.x));
  const right = Math.max(...nodes.map((node) => node.x + node.width));
  const top = Math.min(...nodes.map((node) => node.y));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height));
  const hasSelf = shapes.some((edge) => kindOf(edge) === "self");
  const rightBase = right + (hasSelf ? SELF_LOOP : 0);
  const laneX = (edge: EdgeShape) => {
    const index = lanes.get(edge)!;
    return laneSide(edge) === "left"
      ? left - LANE_GAP * (index + 1)
      : rightBase + LANE_GAP * (index + 1);
  };
  const labelled = (edge: EdgeShape) =>
    edge.transitions.some((transition) => transition.label);

  const edges: GraphEdge[] = shapes.map((edge, index) => {
    const source = boxes.get(edge.from)!;
    const target = boxes.get(edge.to)!;
    const kind = kindOf(edge);
    let points: Point[];
    let label: GraphEdge["label"];
    if (kind === "self") {
      const out = source.x + source.width;
      const loop = out + SELF_LOOP;
      const y1 = source.y + source.height * 0.3;
      const y2 = source.y + source.height * 0.7;
      points = [
        { x: out, y: y1 },
        { x: loop, y: y1 },
        { x: loop, y: y2 },
        { x: out, y: y2 },
      ];
      label = { at: { x: loop + 4, y: (y1 + y2) / 2 }, align: "start" };
    } else if (direct(edge)) {
      const sx = source.x + source.width / 2;
      const tx = target.x + target.width / 2;
      const sy = source.y + source.height;
      const ty = target.y;
      const mid = (sy + ty) / 2;
      points =
        sx === tx
          ? [
              { x: sx, y: sy },
              { x: tx, y: ty },
            ]
          : [
              { x: sx, y: sy },
              { x: sx, y: mid },
              { x: tx, y: mid },
              { x: tx, y: ty },
            ];
      label = { at: { x: tx, y: mid }, align: "center" };
    } else {
      const x = laneX(edge);
      const onLeft = laneSide(edge) === "left";
      const sx = onLeft ? source.x : source.x + source.width;
      const tx = onLeft ? target.x : target.x + target.width;
      const sy = source.y + source.height / 2;
      const ty = target.y + target.height / 2;
      points = [
        { x: sx, y: sy },
        { x, y: sy },
        { x, y: ty },
        { x: tx, y: ty },
      ];
      label = {
        at: { x: onLeft ? x - 4 : x + 4, y: (sy + ty) / 2 },
        align: onLeft ? "end" : "start",
      };
    }
    return {
      id: `${edge.from}->${edge.to}#${index}`,
      from: edge.from,
      to: edge.to,
      kind,
      transitions: edge.transitions,
      points,
      arrow: arrowOf(points),
      label: labelled(edge) ? label : null,
    };
  });

  // Room for lanes and their labels, then shift everything so the drawing starts at MARGIN.
  const leftLanes = routed.filter((edge) => laneSide(edge) === "left");
  const rightLanes = routed.filter((edge) => laneSide(edge) === "right");
  const leftEdge =
    left -
    LANE_GAP * leftLanes.length -
    (leftLanes.some(labelled) ? LABEL_WIDTH : 0);
  const rightEdge =
    rightBase +
    LANE_GAP * rightLanes.length +
    (rightLanes.some(labelled) ||
    shapes.some((edge) => kindOf(edge) === "self" && labelled(edge))
      ? LABEL_WIDTH
      : 0);
  const dx = MARGIN - leftEdge;
  const dy = MARGIN - top;
  const move = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });
  return {
    nodes: nodes.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy })),
    edges: edges.map((edge) => ({
      ...edge,
      points: edge.points.map(move),
      label: edge.label && { ...edge.label, at: move(edge.label.at) },
    })),
    width: rightEdge - leftEdge + 2 * MARGIN,
    height: bottom - top + 2 * MARGIN,
  };
}

export interface Segment {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The rectangles that draw an orthogonal polyline `thickness` wide, centered on its points. */
export function edgeSegments(points: Point[], thickness: number): Segment[] {
  const half = thickness / 2;
  const segments: Segment[] = [];
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    segments.push({
      x: Math.min(a.x, b.x) - half,
      y: Math.min(a.y, b.y) - half,
      width: Math.abs(b.x - a.x) + thickness,
      height: Math.abs(b.y - a.y) + thickness,
    });
  }
  return segments;
}
