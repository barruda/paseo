// CUSTOM(factory): the Pipelines tab (docs/factory.md, "Pipeline editor"), read only for now. The
// graph is plain Views: orthogonal edges are thin rectangles, arrowheads are border triangles.
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { DEFAULT_MAX_VISITS, isBuiltinStage } from "../shared/factory/pipeline";
import type { PipelineFile, PipelineStage } from "../shared/factory/schema";
import type { Board } from "../shared/model";
import { factoryPipelinesRpc } from "../shared/rpc";
import {
  edgeSegments,
  LABEL_WIDTH,
  layoutPipeline,
  pipelineNodeOrder,
  type GraphEdge,
  type GraphNode,
} from "./pipeline-layout";
import { usePipelineStrings, type PipelineStrings } from "./pipeline-strings";
import { pipelineForProject, stageRunnerLabel } from "./pipeline-view";

type Theme = PluginSurfaceProps["theme"];

const ARROW = 6;
const PANEL_WIDTH = 300;

function useFactoryPipelines() {
  const call = useRpc(factoryPipelinesRpc);
  return useQuery({
    queryKey: ["power-workboard", "factory-pipelines"],
    queryFn: () => call({}),
    staleTime: 30_000,
  });
}

export function PipelinesView({
  board,
  theme,
  compact,
}: {
  board: Board;
  theme: Theme;
  compact: boolean;
}) {
  const s = usePipelineStrings();
  const query = useFactoryPipelines();
  const [chosen, setChosen] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const view = query.data;
  const projectId = board.projects.some((p) => p.id === chosen)
    ? chosen
    : (board.projects[0]?.id ?? null);
  const pipelineId =
    view && projectId ? pipelineForProject(view, projectId) : null;
  const pipeline =
    view && pipelineId
      ? (view.pipelines[pipelineId] ?? view.pipelines[view.defaultPipeline])
      : undefined;
  useEffect(() => setSelected(null), [projectId, pipelineId]);

  const muted = { color: theme.colors.foregroundMuted };
  if (query.isPending)
    return <Text style={[styles.note, muted]}>{s.loading}</Text>;
  if (query.isError || !view)
    return <Text style={[styles.note, muted]}>{s.loadFailed}</Text>;
  if (!projectId || !pipeline)
    return <Text style={[styles.note, muted]}>{s.noProjects}</Text>;

  const header = (
    <View style={styles.header}>
      <Text style={[styles.label, muted]}>{s.project}</Text>
      <View style={styles.chips}>
        {board.projects.map((project) => {
          const on = project.id === projectId;
          return (
            <Pressable
              key={project.id}
              accessibilityRole="button"
              onPress={() => setChosen(project.id)}
              style={[
                styles.chip,
                { borderColor: on ? theme.colors.accent : theme.colors.border },
                on && { backgroundColor: theme.colors.surface1 },
              ]}
            >
              <Text
                style={{
                  color: on
                    ? theme.colors.foreground
                    : theme.colors.foregroundMuted,
                }}
              >
                {`${project.name} · ${pipelineForProject(view, project.id)}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.title, { color: theme.colors.foreground }]}>
        {pipelineId}
      </Text>
      {pipeline.description ? (
        <Text style={{ color: theme.colors.foreground }}>
          {pipeline.description}
        </Text>
      ) : null}
      <Text style={[styles.small, muted]}>{s.builtinNote}</Text>
    </View>
  );

  if (compact)
    return (
      <ScrollView contentContainerStyle={styles.page}>
        {header}
        {pipelineNodeOrder(pipeline)
          .filter((id) => !isBuiltinStage(id) && pipeline.stages[id])
          .map((id) => (
            <View
              key={id}
              style={[styles.card, { borderColor: theme.colors.border }]}
            >
              <StageDetails
                id={id}
                pipeline={pipeline}
                projectId={projectId}
                board={board}
                theme={theme}
                s={s}
              />
            </View>
          ))}
      </ScrollView>
    );

  return (
    <View style={styles.wide}>
      <View style={styles.graphColumn}>
        <View style={styles.headerPad}>{header}</View>
        <ScrollView>
          <ScrollView horizontal>
            <Graph
              pipeline={pipeline}
              projectId={projectId}
              board={board}
              theme={theme}
              s={s}
              selected={selected}
              onSelect={setSelected}
            />
          </ScrollView>
        </ScrollView>
      </View>
      <View
        style={[
          styles.panel,
          { borderLeftColor: theme.colors.border, width: PANEL_WIDTH },
        ]}
      >
        <ScrollView contentContainerStyle={styles.panelContent}>
          {selected ? (
            <StageDetails
              id={selected}
              pipeline={pipeline}
              projectId={projectId}
              board={board}
              theme={theme}
              s={s}
            />
          ) : (
            <Text style={muted}>{s.selectStage}</Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function Graph({
  pipeline,
  projectId,
  board,
  theme,
  s,
  selected,
  onSelect,
}: {
  pipeline: PipelineFile;
  projectId: string;
  board: Board;
  theme: Theme;
  s: PipelineStrings;
  selected: string | null;
  onSelect(id: string): void;
}) {
  const graph = useMemo(() => layoutPipeline(pipeline), [pipeline]);
  return (
    <View style={{ width: graph.width, height: graph.height }}>
      {graph.edges.map((edge) => (
        <Edge key={edge.id} edge={edge} theme={theme} />
      ))}
      {graph.nodes.map((node) => (
        <Node
          key={node.id}
          node={node}
          stage={pipeline.stages[node.id]}
          start={pipeline.start === node.id}
          selected={selected === node.id}
          projectId={projectId}
          board={board}
          theme={theme}
          s={s}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

function Edge({ edge, theme }: { edge: GraphEdge; theme: Theme }) {
  const color = theme.colors.foregroundMuted;
  const tip = edge.points[edge.points.length - 1];
  const label = edge.label;
  const text = edge.transitions
    .map((t) => t.label)
    .filter(Boolean)
    .join(" / ");
  return (
    <>
      {edgeSegments(edge.points, 1.5).map((segment, index) => (
        <View
          key={index}
          pointerEvents="none"
          style={{
            position: "absolute",
            left: segment.x,
            top: segment.y,
            width: segment.width,
            height: segment.height,
            backgroundColor: color,
          }}
        />
      ))}
      {tip ? (
        <View
          pointerEvents="none"
          style={[
            styles.arrow,
            arrowStyle(edge.arrow, color),
            arrowPosition(edge.arrow, tip),
          ]}
        />
      ) : null}
      {label && text ? (
        <Text
          numberOfLines={2}
          style={[
            styles.edgeLabel,
            {
              left:
                label.align === "start"
                  ? label.at.x
                  : label.align === "end"
                    ? label.at.x - LABEL_WIDTH
                    : label.at.x - LABEL_WIDTH / 2,
              top: label.at.y - 9,
              backgroundColor: theme.colors.surface0,
              color,
              textAlign:
                label.align === "start"
                  ? "left"
                  : label.align === "end"
                    ? "right"
                    : "center",
            },
          ]}
        >
          {text}
        </Text>
      ) : null}
    </>
  );
}

/** A triangle by borders: the colored border is the side the arrow points away from. */
function arrowStyle(direction: GraphEdge["arrow"], color: string) {
  const side = { borderColor: "transparent" };
  switch (direction) {
    case "down":
      return {
        ...side,
        borderLeftWidth: ARROW,
        borderRightWidth: ARROW,
        borderTopWidth: ARROW * 1.5,
        borderTopColor: color,
      };
    case "up":
      return {
        ...side,
        borderLeftWidth: ARROW,
        borderRightWidth: ARROW,
        borderBottomWidth: ARROW * 1.5,
        borderBottomColor: color,
      };
    case "right":
      return {
        ...side,
        borderTopWidth: ARROW,
        borderBottomWidth: ARROW,
        borderLeftWidth: ARROW * 1.5,
        borderLeftColor: color,
      };
    default:
      return {
        ...side,
        borderTopWidth: ARROW,
        borderBottomWidth: ARROW,
        borderRightWidth: ARROW * 1.5,
        borderRightColor: color,
      };
  }
}

/** Puts the arrowhead's tip on the edge's last point. */
function arrowPosition(
  direction: GraphEdge["arrow"],
  tip: { x: number; y: number },
) {
  const long = ARROW * 1.5;
  switch (direction) {
    case "down":
      return { left: tip.x - ARROW, top: tip.y - long };
    case "up":
      return { left: tip.x - ARROW, top: tip.y };
    case "right":
      return { left: tip.x - long, top: tip.y - ARROW };
    default:
      return { left: tip.x, top: tip.y - ARROW };
  }
}

function Node({
  node,
  stage,
  start,
  selected,
  projectId,
  board,
  theme,
  s,
  onSelect,
}: {
  node: GraphNode;
  stage: PipelineStage | undefined;
  start: boolean;
  selected: boolean;
  projectId: string;
  board: Board;
  theme: Theme;
  s: PipelineStrings;
  onSelect(id: string): void;
}) {
  const terminal = node.kind === "builtin" || !stage;
  const tags = stage
    ? [
        start ? s.start : null,
        stage.gate ? s.gate : null,
        stage.session === "fresh" ? s.fresh : null,
      ].filter((tag): tag is string => tag !== null)
    : [];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onSelect(node.id)}
      style={[
        styles.node,
        {
          left: node.x,
          top: node.y,
          width: node.width,
          height: node.height,
          borderRadius: terminal ? node.height / 2 : 10,
          borderColor: selected ? theme.colors.accent : theme.colors.border,
          backgroundColor: theme.colors.surface1,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          terminal ? styles.terminalText : styles.nodeId,
          {
            color: terminal
              ? theme.colors.foregroundMuted
              : theme.colors.foreground,
          },
        ]}
      >
        {node.id}
      </Text>
      {stage ? (
        <Text
          numberOfLines={1}
          style={[styles.small, { color: theme.colors.foregroundMuted }]}
        >
          {`${stage.role} · ${stageRunnerLabel(stage, projectId, board.orchestrators, s)}`}
        </Text>
      ) : null}
      {tags.length ? (
        <View style={styles.tags}>
          {tags.map((tag) => (
            <Text
              key={tag}
              style={[
                styles.tag,
                {
                  borderColor: theme.colors.border,
                  color: theme.colors.foregroundMuted,
                },
              ]}
            >
              {tag}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

function StageDetails({
  id,
  pipeline,
  projectId,
  board,
  theme,
  s,
}: {
  id: string;
  pipeline: PipelineFile;
  projectId: string;
  board: Board;
  theme: Theme;
  s: PipelineStrings;
}) {
  const muted = { color: theme.colors.foregroundMuted };
  const text = { color: theme.colors.foreground };
  const stage = pipeline.stages[id];
  if (!stage)
    return (
      <View style={styles.details}>
        <Text style={[styles.nodeId, text]}>{id}</Text>
        <Text style={text}>
          {isBuiltinStage(id) ? s.builtinStages[id] : id}
        </Text>
      </View>
    );
  const field = (name: string, value: string) => (
    <Text style={text}>
      <Text style={muted}>{`${name}: `}</Text>
      {value}
    </Text>
  );
  const procedure = stage.prompt
    ? null
    : stage.file
      ? `${s.procedureFile}: ${stage.file}`
      : `${s.procedureFile}: roles/${stage.role}.md`;
  return (
    <View style={styles.details}>
      <Text style={[styles.nodeId, text]}>{id}</Text>
      {field(s.role, stage.role)}
      {field(
        s.worker,
        stageRunnerLabel(stage, projectId, board.orchestrators, s),
      )}
      {field(
        s.session,
        stage.session === "fresh" ? s.sessionFresh : s.sessionContinue,
      )}
      {field(s.maxVisits, String(stage.maxVisits ?? DEFAULT_MAX_VISITS))}
      <Text style={muted}>{s.procedure}</Text>
      {stage.prompt ? (
        <ScrollView style={styles.prompt} nestedScrollEnabled>
          <Text style={text}>{`${s.procedurePrompt}: ${stage.prompt}`}</Text>
        </ScrollView>
      ) : (
        <Text style={text}>{procedure}</Text>
      )}
      {stage.gate ? (
        <>
          <Text style={muted}>{s.gateQuestion}</Text>
          <Text style={text}>{stage.gate.question}</Text>
          <Text style={muted}>{s.options}</Text>
          {stage.gate.options.map((option) => (
            <Text key={option.id} style={text}>
              {`${option.label} → ${option.to ?? "?"}`}
            </Text>
          ))}
        </>
      ) : null}
      {stage.to !== undefined ? (
        <>
          <Text style={muted}>{s.transitions}</Text>
          {typeof stage.to === "string" ? (
            <Text style={text}>{`→ ${stage.to}`}</Text>
          ) : (
            stage.to.map((option) => (
              <Text key={`${option.stage}:${option.when}`} style={text}>
                {`${option.stage}: ${option.when}`}
              </Text>
            ))
          )}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10, maxWidth: 1200 },
  note: { padding: 24, textAlign: "center" },
  header: { gap: 6 },
  headerPad: { paddingHorizontal: 16, paddingTop: 16 },
  label: { fontSize: 12 },
  title: { fontSize: 18, fontWeight: "600" },
  small: { fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  wide: { flex: 1, flexDirection: "row" },
  graphColumn: { flex: 1 },
  panel: { borderLeftWidth: 1 },
  panelContent: { padding: 16 },
  card: { borderWidth: 1, borderRadius: 10, padding: 12 },
  details: { gap: 6 },
  prompt: { maxHeight: 220 },
  node: {
    position: "absolute",
    borderWidth: 1,
    paddingHorizontal: 10,
    justifyContent: "center",
    gap: 2,
  },
  nodeId: { fontSize: 14, fontWeight: "700" },
  terminalText: { fontSize: 13, textAlign: "center" },
  tags: { flexDirection: "row", gap: 4 },
  tag: {
    fontSize: 10,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 4,
  },
  arrow: { position: "absolute", width: 0, height: 0 },
  edgeLabel: { position: "absolute", width: LABEL_WIDTH, fontSize: 11 },
});
