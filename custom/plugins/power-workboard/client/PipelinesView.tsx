// CUSTOM(factory): the Pipelines tab (docs/factory.md, "Pipeline editor"). With the factory on, a
// wide screen edits the pipeline in a local draft (move and connect nodes, edit the stage panel)
// and Save writes it; otherwise it is read only. The graph is plain Views: orthogonal edges are
// thin rectangles, arrowheads are border triangles.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import {
  SettingsCard,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import {
  DEFAULT_MAX_VISITS,
  isBuiltinStage,
  stageTargets,
} from "../shared/factory/pipeline";
import {
  addStage,
  connectStages,
  disconnectStages,
  draftDirty,
  moveNode,
  pipelineIssues,
  removeStage,
  renameStage,
  setGate,
  setStart,
  stageIssues,
  startDraft,
  transitionTargets,
  updateStage,
  type PipelineDraft,
  type PipelineIssue,
  type Point,
  type RenameError,
} from "../shared/factory/pipeline-edit";
import {
  STAGE_ROLES,
  type PipelineFile,
  type PipelineStage,
  type StageRole,
} from "../shared/factory/schema";
import type { Board } from "../shared/model";
import {
  factoryAutonomySetRpc,
  factoryPipelineSaveRpc,
  factoryPipelinesRpc,
} from "../shared/rpc";
import {
  edgeSegments,
  keepManualLayout,
  LABEL_WIDTH,
  layoutPipeline,
  layoutPositions,
  nodeAt,
  pipelineNodeOrder,
  type GraphEdge,
  type GraphNode,
} from "./pipeline-layout";
import { usePipelineStrings, type PipelineStrings } from "./pipeline-strings";
import {
  autonomyOfChoice,
  autonomyOptions,
  autonomySummary,
  INHERIT_AUTONOMY,
  pipelineForProject,
  pipelineInheritedAutonomy,
  projectInheritedAutonomy,
  stageRunnerLabel,
  type AutonomyChoice,
} from "./pipeline-view";

type Theme = PluginSurfaceProps["theme"];
type Edit = (draft: PipelineDraft) => PipelineDraft;

type Preset = Exclude<AutonomyChoice, typeof INHERIT_AUTONOMY>;

const ARROW = 6;
const PANEL_WIDTH = 300;
const HANDLE = 14;
const DRAG_SLOP = 4;
const ISSUES_SHOWN = 5;
const QUERY_KEY = ["power-workboard", "factory-pipelines"];

function useFactoryPipelines() {
  const call = useRpc(factoryPipelinesRpc);
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => call({}),
    staleTime: 30_000,
  });
}

export function PipelinesView({
  board,
  theme,
  compact,
  onError,
}: {
  board: Board;
  theme: Theme;
  compact: boolean;
  onError(error: unknown): void;
}) {
  const s = usePipelineStrings();
  const query = useFactoryPipelines();
  const queryClient = useQueryClient();
  const callSave = useRpc(factoryPipelineSaveRpc);
  const callAutonomy = useRpc(factoryAutonomySetRpc);
  const [chosen, setChosen] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PipelineDraft>>({});
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
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
  const editing = view?.source === "factory" && !compact;
  useEffect(() => setSelected(null), [projectId, pipelineId]);

  const started = useMemo(
    () => (pipeline ? startDraft(pipeline) : null),
    [pipeline],
  );
  const stored = pipelineId ? drafts[pipelineId] : undefined;
  const draft =
    stored && (draftDirty(stored) || stored.base === pipeline)
      ? stored
      : started;
  const shown = editing && draft ? draft.pipeline : pipeline;
  const issues = useMemo(
    () => (editing && draft ? pipelineIssues(draft.pipeline) : []),
    [editing, draft],
  );
  const dirty = draft ? draftDirty(draft) : false;

  const commit = (next: PipelineDraft) => {
    if (pipelineId) setDrafts((all) => ({ ...all, [pipelineId]: next }));
  };
  const apply = (edit: Edit) => {
    if (!draft) return;
    const next = edit(draft);
    commit({
      ...next,
      pipeline: keepManualLayout(draft.pipeline, next.pipeline),
    });
  };
  const rename = (from: string, to: string): RenameError | null => {
    if (!draft) return null;
    const next = renameStage(draft, from, to);
    if ("error" in next) return next.error;
    commit(next);
    setSelected(to);
    return null;
  };
  const discard = () => {
    if (!pipelineId) return;
    setDrafts(({ [pipelineId]: _dropped, ...rest }) => rest);
    setSelected(null);
  };
  const save = async () => {
    if (!draft || !pipelineId || saving) return;
    setSaving(true);
    try {
      const fresh = await callSave({
        id: pipelineId,
        base: draft.base,
        pipeline: draft.pipeline,
        renames: draft.renames,
      });
      queryClient.setQueryData(QUERY_KEY, fresh);
      setDrafts(({ [pipelineId]: _saved, ...rest }) => rest);
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  };
  const setAutonomy = async (
    target: "pipeline" | "project",
    id: string,
    choice: AutonomyChoice,
  ) => {
    try {
      const fresh = await callAutonomy({
        target,
        id,
        autonomy: autonomyOfChoice(choice),
      });
      queryClient.setQueryData(QUERY_KEY, fresh);
    } catch (error) {
      onError(error);
    }
  };

  const muted = { color: theme.colors.foregroundMuted };
  if (query.isPending)
    return <Text style={[styles.note, muted]}>{s.loading}</Text>;
  if (query.isError || !view)
    return <Text style={[styles.note, muted]}>{s.loadFailed}</Text>;
  if (!projectId || !pipeline || !pipelineId || !shown)
    return <Text style={[styles.note, muted]}>{s.noProjects}</Text>;

  const selectedId =
    selected && (shown.stages[selected] || isBuiltinStage(selected))
      ? selected
      : null;
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
      {view.source === "factory" ? (
        <AutonomySelect
          label={s.projectAutonomy}
          own={view.projectAutonomy?.[projectId]}
          inherited={projectInheritedAutonomy(view, projectId)}
          readOnly={!editing}
          theme={theme}
          s={s}
          onChange={(choice) => setAutonomy("project", projectId, choice)}
        />
      ) : null}
      <Text style={[styles.title, { color: theme.colors.foreground }]}>
        {pipelineId}
      </Text>
      {view.source === "factory" ? (
        <AutonomySelect
          label={s.pipelineAutonomy}
          own={pipeline.autonomy}
          inherited={pipelineInheritedAutonomy(view)}
          readOnly={!editing}
          theme={theme}
          s={s}
          onChange={(choice) => setAutonomy("pipeline", pipelineId, choice)}
        />
      ) : null}
      {pipeline.description ? (
        <Text style={{ color: theme.colors.foreground }}>
          {pipeline.description}
        </Text>
      ) : null}
      {view.source === "builtin" ? (
        <Text style={[styles.small, muted]}>{s.builtinNote}</Text>
      ) : null}
      {editing && draft ? (
        <Toolbar
          dirty={dirty}
          saving={saving}
          issues={issues}
          theme={theme}
          s={s}
          onAdd={() => {
            const added = addStage(draft, "implement");
            commit({
              ...added.draft,
              pipeline: keepManualLayout(draft.pipeline, added.draft.pipeline),
            });
            setSelected(added.id);
          }}
          onSave={save}
          onDiscard={discard}
        />
      ) : null}
    </View>
  );

  if (!editing || !draft)
    return compact ? (
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
    ) : (
      <WideLayout
        header={header}
        pipeline={pipeline}
        projectId={projectId}
        board={board}
        theme={theme}
        s={s}
        selected={selectedId}
        onSelect={setSelected}
        scrollEnabled
      />
    );

  return (
    <WideLayout
      header={header}
      pipeline={draft.pipeline}
      projectId={projectId}
      board={board}
      theme={theme}
      s={s}
      selected={selectedId}
      onSelect={setSelected}
      scrollEnabled={!dragging}
      editor={{
        issues,
        onActive: setDragging,
        onMove: (id, at, placed) => apply((d) => moveNode(d, id, at, placed)),
        onConnect: (from, to) => apply((d) => connectStages(d, from, to)),
        panel: (
          <StageEditor
            key={selectedId ?? ""}
            id={selectedId}
            draft={draft}
            issues={issues}
            workers={view.workers ?? {}}
            theme={theme}
            s={s}
            apply={apply}
            rename={rename}
            onDeleted={() => setSelected(null)}
          />
        ),
      }}
    />
  );
}

interface EditorProps {
  issues: PipelineIssue[];
  onActive(active: boolean): void;
  onMove(id: string, at: Point, placed: Record<string, Point>): void;
  onConnect(from: string, to: string): void;
  panel: React.ReactNode;
}

function WideLayout({
  header,
  pipeline,
  projectId,
  board,
  theme,
  s,
  selected,
  onSelect,
  scrollEnabled,
  editor,
}: {
  header: React.ReactNode;
  pipeline: PipelineFile;
  projectId: string;
  board: Board;
  theme: Theme;
  s: PipelineStrings;
  selected: string | null;
  onSelect(id: string): void;
  scrollEnabled: boolean;
  editor?: EditorProps;
}) {
  return (
    <View style={styles.wide}>
      <View style={styles.graphColumn}>
        <View style={styles.headerPad}>{header}</View>
        <ScrollView scrollEnabled={scrollEnabled}>
          <ScrollView horizontal scrollEnabled={scrollEnabled}>
            <Graph
              pipeline={pipeline}
              projectId={projectId}
              board={board}
              theme={theme}
              s={s}
              selected={selected}
              onSelect={onSelect}
              editor={editor}
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
        <ScrollView
          contentContainerStyle={styles.panelContent}
          scrollEnabled={scrollEnabled}
        >
          {editor ? (
            editor.panel
          ) : selected ? (
            <StageDetails
              id={selected}
              pipeline={pipeline}
              projectId={projectId}
              board={board}
              theme={theme}
              s={s}
            />
          ) : (
            <Text style={{ color: theme.colors.foregroundMuted }}>
              {s.selectStage}
            </Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function AutonomySelect({
  label,
  own,
  inherited,
  readOnly,
  theme,
  s,
  onChange,
}: {
  label: string;
  own: Preset | null | undefined;
  inherited: Preset;
  readOnly: boolean;
  theme: Theme;
  s: PipelineStrings;
  onChange(choice: AutonomyChoice): void;
}) {
  const summary = autonomySummary(own ?? inherited, s);
  return (
    <View style={styles.autonomy}>
      {readOnly ? (
        <Text style={[styles.label, { color: theme.colors.foregroundMuted }]}>
          {label}
        </Text>
      ) : (
        <SettingsCard>
          <SettingsSelect<AutonomyChoice>
            label={label}
            value={own ?? INHERIT_AUTONOMY}
            options={autonomyOptions(inherited, s)}
            onValueChange={onChange}
          />
        </SettingsCard>
      )}
      <Text style={[styles.small, { color: theme.colors.foregroundMuted }]}>
        {summary}
      </Text>
    </View>
  );
}

function Toolbar({
  dirty,
  saving,
  issues,
  theme,
  s,
  onAdd,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  issues: PipelineIssue[];
  theme: Theme;
  s: PipelineStrings;
  onAdd(): void;
  onSave(): void;
  onDiscard(): void;
}) {
  const canSave = dirty && issues.length === 0 && !saving;
  return (
    <View style={styles.toolbar}>
      <View style={styles.row}>
        <ActionButton label={s.addStage} theme={theme} onPress={onAdd} />
        <ActionButton
          label={saving ? s.saving : s.save}
          theme={theme}
          primary
          disabled={!canSave}
          onPress={onSave}
        />
        <ActionButton
          label={s.discard}
          theme={theme}
          disabled={!dirty}
          onPress={onDiscard}
        />
        {dirty ? (
          <Text style={[styles.small, { color: theme.colors.foregroundMuted }]}>
            {s.unsaved}
          </Text>
        ) : null}
      </View>
      {issues.length ? (
        <View style={styles.details}>
          <Text style={[styles.small, { color: theme.colors.statusWarning }]}>
            {s.problems.replace("{count}", String(issues.length))}
          </Text>
          {issues.slice(0, ISSUES_SHOWN).map((issue, index) => (
            <Text
              key={index}
              style={[styles.small, { color: theme.colors.statusWarning }]}
            >
              {`${issue.path.join(".")}: ${issue.message}`}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ActionButton({
  label,
  theme,
  onPress,
  disabled,
  primary,
  danger,
}: {
  label: string;
  theme: Theme;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          borderColor: danger ? theme.colors.statusDanger : theme.colors.border,
          backgroundColor: primary
            ? theme.colors.accent
            : theme.colors.surface1,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: primary
            ? theme.colors.accentForeground
            : danger
              ? theme.colors.statusDanger
              : theme.colors.foreground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** One PanResponder whose callbacks always see the latest props. */
function useDrag(handlers: {
  start(): void;
  move(dx: number, dy: number): void;
  end(dx: number, dy: number): void;
  cancel(): void;
}) {
  const latest = useRef(handlers);
  latest.current = handlers;
  return useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => latest.current.start(),
        onPanResponderMove: (_event, g) => latest.current.move(g.dx, g.dy),
        onPanResponderRelease: (_event, g) => latest.current.end(g.dx, g.dy),
        onPanResponderTerminate: () => latest.current.cancel(),
      }),
    [],
  );
}

type Moving = { id: string; dx: number; dy: number };
type Linking = { from: string; point: Point; over: string | null };

function Graph({
  pipeline,
  projectId,
  board,
  theme,
  s,
  selected,
  onSelect,
  editor,
}: {
  pipeline: PipelineFile;
  projectId: string;
  board: Board;
  theme: Theme;
  s: PipelineStrings;
  selected: string | null;
  onSelect(id: string): void;
  editor?: EditorProps;
}) {
  const graph = useMemo(() => layoutPipeline(pipeline), [pipeline]);
  const [moving, setMoving] = useState<Moving | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const onActive = editor?.onActive;
  useEffect(
    () => onActive?.(moving !== null || linking !== null),
    [onActive, moving, linking],
  );
  const onMove = editor?.onMove;
  const onConnect = editor?.onConnect;
  const drop = useCallback(
    (id: string, dx: number, dy: number) => {
      setMoving(null);
      if (Math.hypot(dx, dy) <= DRAG_SLOP) return onSelect(id);
      const placed = layoutPositions(graph);
      const from = placed[id];
      if (from) onMove?.(id, { x: from.x + dx, y: from.y + dy }, placed);
    },
    [graph, onMove, onSelect],
  );
  const link = useCallback(
    (from: string, dx: number, dy: number, done: boolean) => {
      const node = graph.nodes.find((n) => n.id === from);
      if (!node) return;
      const point = {
        x: node.x + node.width / 2 + dx,
        y: node.y + node.height + dy,
      };
      const over = nodeAt(graph, point)?.id ?? null;
      if (!done) return setLinking({ from, point, over });
      setLinking(null);
      // A tap on the handle lands on its own node's edge: no self loop by accident.
      if (over && Math.hypot(dx, dy) > DRAG_SLOP) onConnect?.(from, over);
    },
    [graph, onConnect],
  );
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
          editor={
            editor
              ? {
                  warn: stageIssues(editor.issues, node.id).length > 0,
                  target: linking?.over === node.id,
                  shift: moving?.id === node.id ? moving : null,
                  onDrag: (dx, dy) => setMoving({ id: node.id, dx, dy }),
                  onDrop: (dx, dy) => drop(node.id, dx, dy),
                  onCancel: () => setMoving(null),
                }
              : undefined
          }
        />
      ))}
      {editor
        ? graph.nodes
            .filter((node) => node.kind === "stage" && pipeline.stages[node.id])
            .map((node) => (
              <ConnectHandle
                key={node.id}
                node={node}
                shift={moving?.id === node.id ? moving : null}
                theme={theme}
                onLink={(dx, dy, done) => link(node.id, dx, dy, done)}
                onCancel={() => setLinking(null)}
              />
            ))
        : null}
      {linking ? (
        <View
          pointerEvents="none"
          style={[
            styles.dot,
            {
              left: linking.point.x - HANDLE / 2,
              top: linking.point.y - HANDLE / 2,
              backgroundColor: theme.colors.accent,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

function ConnectHandle({
  node,
  shift,
  theme,
  onLink,
  onCancel,
}: {
  node: GraphNode;
  shift: Moving | null;
  theme: Theme;
  onLink(dx: number, dy: number, done: boolean): void;
  onCancel(): void;
}) {
  const responder = useDrag({
    start: () => onLink(0, 0, false),
    move: (dx, dy) => onLink(dx, dy, false),
    end: (dx, dy) => onLink(dx, dy, true),
    cancel: onCancel,
  });
  return (
    <View
      {...responder.panHandlers}
      accessibilityRole="button"
      style={[
        styles.handle,
        {
          left: node.x + (shift?.dx ?? 0) + node.width / 2 - HANDLE / 2,
          top: node.y + (shift?.dy ?? 0) + node.height - HANDLE / 2,
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.surface0,
        },
      ]}
    />
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

interface NodeEditor {
  warn: boolean;
  target: boolean;
  shift: Moving | null;
  onDrag(dx: number, dy: number): void;
  onDrop(dx: number, dy: number): void;
  onCancel(): void;
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
  editor,
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
  editor?: NodeEditor;
}) {
  const responder = useDrag({
    start: () => editor?.onDrag(0, 0),
    move: (dx, dy) => editor?.onDrag(dx, dy),
    end: (dx, dy) => editor?.onDrop(dx, dy),
    cancel: () => editor?.onCancel(),
  });
  const terminal = node.kind === "builtin" || !stage;
  const tags = stage
    ? [
        start ? s.start : null,
        stage.gate ? s.gate : null,
        stage.session === "fresh" ? s.fresh : null,
      ].filter((tag): tag is string => tag !== null)
    : [];
  const Body = editor ? View : Pressable;
  const press = editor
    ? responder.panHandlers
    : { onPress: () => onSelect(node.id) };
  const border = editor?.warn
    ? theme.colors.statusWarning
    : selected || editor?.target
      ? theme.colors.accent
      : theme.colors.border;
  return (
    <Body
      {...press}
      accessibilityRole="button"
      style={[
        styles.node,
        {
          left: node.x + (editor?.shift?.dx ?? 0),
          top: node.y + (editor?.shift?.dy ?? 0),
          zIndex: editor?.shift ? 2 : 0,
          width: node.width,
          height: node.height,
          borderRadius: terminal ? node.height / 2 : 10,
          borderColor: border,
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
    </Body>
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

type ApplyEdit = (edit: Edit) => void;
type Gate = NonNullable<PipelineStage["gate"]>;
type Condition = { stage: string; when: string };

const NO_TARGET = "";
const DEFAULT_PROCEDURE = "default";
type Procedure = "default" | "prompt" | "file";
type Mode = "none" | "one" | "many";

function inputStyle(theme: Theme) {
  return [
    styles.input,
    { color: theme.colors.foreground, borderColor: theme.colors.border },
  ];
}

function StageEditor({
  id,
  draft,
  issues,
  workers,
  theme,
  s,
  apply,
  rename,
  onDeleted,
}: {
  id: string | null;
  draft: PipelineDraft;
  issues: PipelineIssue[];
  workers: Record<string, string>;
  theme: Theme;
  s: PipelineStrings;
  apply: ApplyEdit;
  rename(from: string, to: string): RenameError | null;
  onDeleted(): void;
}) {
  const pipeline = draft.pipeline;
  const stage = id ? pipeline.stages[id] : undefined;
  const [idText, setIdText] = useState(id ?? "");
  const [idError, setIdError] = useState<RenameError | null>(null);
  const [confirming, setConfirming] = useState(false);
  const muted = { color: theme.colors.foregroundMuted };
  const text = { color: theme.colors.foreground };
  if (!id) return <Text style={muted}>{s.selectStage}</Text>;
  if (!stage)
    return (
      <View style={styles.details}>
        <Text style={[styles.nodeId, text]}>{id}</Text>
        <Text style={text}>
          {isBuiltinStage(id) ? s.builtinStages[id] : id}
        </Text>
      </View>
    );
  const patch = (change: Partial<Record<keyof PipelineStage, unknown>>) =>
    apply((d) => updateStage(d, id, change as Partial<PipelineStage>));
  const submitId = () => {
    const error = idText === id ? null : rename(id, idText);
    setIdError(error);
    if (error) setIdText(id);
  };
  const targets = transitionTargets(pipeline);
  const current = stageTargets(stage);
  const idMessage = idError
    ? { invalid: s.idInvalid, builtin: s.idBuiltin, taken: s.idTaken }[idError]
    : null;
  const own = stageIssues(issues, id);
  return (
    <View style={styles.details}>
      <Text style={[styles.label, muted]}>{s.stageId}</Text>
      <TextInput
        accessibilityLabel={s.stageId}
        value={idText}
        onChangeText={setIdText}
        onBlur={submitId}
        onSubmitEditing={submitId}
        autoCapitalize="none"
        autoCorrect={false}
        style={inputStyle(theme)}
      />
      {idMessage ? (
        <Text style={[styles.small, { color: theme.colors.statusWarning }]}>
          {idMessage}
        </Text>
      ) : null}
      {pipeline.start === id ? (
        <Text
          style={[
            styles.tag,
            styles.startTag,
            { borderColor: theme.colors.border },
            muted,
          ]}
        >
          {s.start}
        </Text>
      ) : (
        <ActionButton
          label={s.setStart}
          theme={theme}
          onPress={() => apply((d) => setStart(d, id))}
        />
      )}
      <SettingsCard>
        <SettingsSelect<StageRole>
          label={s.role}
          value={stage.role}
          options={STAGE_ROLES.map((role) => ({ value: role, label: role }))}
          onValueChange={(role) => patch({ role })}
        />
        <WorkerSelect stage={stage} workers={workers} s={s} patch={patch} />
        <SettingsSelect<"continue" | "fresh">
          label={s.session}
          value={stage.session === "fresh" ? "fresh" : "continue"}
          options={[
            { value: "continue", label: s.sessionContinue },
            { value: "fresh", label: s.sessionFresh },
          ]}
          onValueChange={(session) =>
            patch({ session: session === "fresh" ? "fresh" : undefined })
          }
        />
      </SettingsCard>
      <ProcedureEditor stage={stage} theme={theme} s={s} patch={patch} />
      <Text style={[styles.label, muted]}>{s.maxVisits}</Text>
      <TextInput
        accessibilityLabel={s.maxVisits}
        value={stage.maxVisits === undefined ? "" : String(stage.maxVisits)}
        placeholder={String(DEFAULT_MAX_VISITS)}
        placeholderTextColor={theme.colors.foregroundMuted}
        keyboardType="number-pad"
        onChangeText={(value) => {
          if (value.trim() === "") return patch({ maxVisits: undefined });
          const number = parseInt(value, 10);
          if (!Number.isNaN(number)) patch({ maxVisits: number });
        }}
        style={inputStyle(theme)}
      />
      <SettingsCard>
        <SettingsSwitch
          label={s.gateOn}
          value={stage.gate !== undefined}
          onValueChange={(on) => apply((d) => setGate(d, id, on))}
        />
      </SettingsCard>
      {stage.gate ? (
        <GateEditor
          gate={stage.gate}
          targets={targets}
          theme={theme}
          s={s}
          onChange={(gate) => patch({ gate })}
        />
      ) : (
        <TransitionsEditor
          stage={stage}
          targets={targets}
          theme={theme}
          s={s}
          patch={patch}
        />
      )}
      <Text style={[styles.label, muted]}>{s.targets}</Text>
      <View style={styles.chips}>
        {current.map((target, index) => (
          <View
            key={`${target}:${index}`}
            style={[
              styles.chip,
              styles.row,
              { borderColor: theme.colors.border },
            ]}
          >
            <Text style={text}>{target}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${s.remove} ${target}`}
              onPress={() => apply((d) => disconnectStages(d, id, target))}
            >
              <Text style={muted}>×</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <SettingsCard>
        <SettingsSelect<string>
          label={s.connectTo}
          value={NO_TARGET}
          options={[
            { value: NO_TARGET, label: "—" },
            ...targets
              .filter((target) => !current.includes(target))
              .map((target) => ({ value: target, label: target })),
          ]}
          onValueChange={(target) =>
            target !== NO_TARGET && apply((d) => connectStages(d, id, target))
          }
        />
      </SettingsCard>
      <ActionButton
        label={confirming ? s.confirmDelete : s.deleteStage}
        theme={theme}
        danger
        onPress={() => {
          if (!confirming) return setConfirming(true);
          apply((d) => removeStage(d, id));
          onDeleted();
        }}
      />
      {own.map((issue, index) => (
        <Text
          key={index}
          style={[styles.small, { color: theme.colors.statusWarning }]}
        >
          {`${issue.path.slice(2).join(".") || issue.path.join(".")}: ${issue.message}`}
        </Text>
      ))}
    </View>
  );
}

type Patch = (change: Partial<Record<keyof PipelineStage, unknown>>) => void;

function WorkerSelect({
  stage,
  workers,
  s,
  patch,
}: {
  stage: PipelineStage;
  workers: Record<string, string>;
  s: PipelineStrings;
  patch: Patch;
}) {
  const pinned = stage.worker;
  const entries = Object.entries(workers);
  if (pinned && !(pinned in workers)) entries.push([pinned, pinned]);
  return (
    <SettingsSelect<string>
      label={s.worker}
      value={pinned ?? ""}
      options={[
        { value: "", label: s.workerAuto },
        ...entries.map(([value, label]) => ({ value, label })),
      ]}
      onValueChange={(worker) => patch({ worker: worker || undefined })}
    />
  );
}

function ProcedureEditor({
  stage,
  theme,
  s,
  patch,
}: {
  stage: PipelineStage;
  theme: Theme;
  s: PipelineStrings;
  patch: Patch;
}) {
  const mode: Procedure =
    stage.prompt !== undefined
      ? "prompt"
      : stage.file !== undefined
        ? "file"
        : DEFAULT_PROCEDURE;
  const value = stage.prompt ?? stage.file ?? "";
  return (
    <>
      <SettingsCard>
        <SettingsSelect<Procedure>
          label={s.procedure}
          value={mode}
          options={[
            {
              value: DEFAULT_PROCEDURE,
              label: `${s.procedureDefault} (roles/${stage.role}.md)`,
            },
            { value: "prompt", label: s.procedurePrompt },
            { value: "file", label: s.procedureFile },
          ]}
          onValueChange={(next) =>
            patch({
              prompt: next === "prompt" ? value : undefined,
              file: next === "file" ? value : undefined,
            })
          }
        />
      </SettingsCard>
      {mode === "prompt" ? (
        <TextInput
          accessibilityLabel={s.procedurePrompt}
          value={stage.prompt ?? ""}
          onChangeText={(prompt) => patch({ prompt })}
          multiline
          style={[inputStyle(theme), styles.multiline]}
        />
      ) : mode === "file" ? (
        <TextInput
          accessibilityLabel={s.procedureFile}
          value={stage.file ?? ""}
          onChangeText={(file) => patch({ file })}
          autoCapitalize="none"
          autoCorrect={false}
          style={inputStyle(theme)}
        />
      ) : null}
    </>
  );
}

function GateEditor({
  gate,
  targets,
  theme,
  s,
  onChange,
}: {
  gate: Gate;
  targets: string[];
  theme: Theme;
  s: PipelineStrings;
  onChange(gate: Gate): void;
}) {
  const muted = { color: theme.colors.foregroundMuted };
  const setOption = (index: number, change: Partial<Gate["options"][number]>) =>
    onChange({
      ...gate,
      options: gate.options.map((option, i) =>
        i === index ? { ...option, ...change } : option,
      ),
    });
  const addOption = () => {
    const taken = new Set(gate.options.map((option) => option.id));
    let id = "option";
    for (let n = 2; taken.has(id); n++) id = `option-${n}`;
    onChange({ ...gate, options: [...gate.options, { id, label: "" }] });
  };
  return (
    <View style={styles.details}>
      <Text style={[styles.label, muted]}>{s.gateQuestion}</Text>
      <TextInput
        accessibilityLabel={s.gateQuestion}
        value={gate.question}
        onChangeText={(question) => onChange({ ...gate, question })}
        multiline
        style={[inputStyle(theme), styles.multiline]}
      />
      <Text style={[styles.label, muted]}>{s.options}</Text>
      {gate.options.map((option, index) => (
        <View
          key={index}
          style={[styles.card, { borderColor: theme.colors.border }]}
        >
          <TextInput
            accessibilityLabel={s.optionId}
            placeholder={s.optionId}
            placeholderTextColor={theme.colors.foregroundMuted}
            value={option.id}
            onChangeText={(value) => setOption(index, { id: value })}
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle(theme)}
          />
          <TextInput
            accessibilityLabel={s.optionLabel}
            placeholder={s.optionLabel}
            placeholderTextColor={theme.colors.foregroundMuted}
            value={option.label}
            onChangeText={(label) => setOption(index, { label })}
            style={inputStyle(theme)}
          />
          <SettingsSelect<string>
            label={s.optionTo}
            value={option.to ?? NO_TARGET}
            options={[
              { value: NO_TARGET, label: "—" },
              ...targets.map((target) => ({ value: target, label: target })),
            ]}
            onValueChange={(to) => setOption(index, { to: to || undefined })}
          />
          <ActionButton
            label={s.remove}
            theme={theme}
            onPress={() =>
              onChange({
                ...gate,
                options: gate.options.filter((_, i) => i !== index),
              })
            }
          />
        </View>
      ))}
      <ActionButton label={s.addOption} theme={theme} onPress={addOption} />
    </View>
  );
}

function TransitionsEditor({
  stage,
  targets,
  theme,
  s,
  patch,
}: {
  stage: PipelineStage;
  targets: string[];
  theme: Theme;
  s: PipelineStrings;
  patch: Patch;
}) {
  const to = stage.to;
  const mode: Mode =
    to === undefined ? "none" : typeof to === "string" ? "one" : "many";
  const options = (list: readonly string[]) => [
    ...list.map((target) => ({ value: target, label: target })),
  ];
  const conditions: Condition[] = Array.isArray(to) ? to : [];
  const setCondition = (index: number, change: Partial<Condition>) =>
    patch({
      to: conditions.map((c, i) => (i === index ? { ...c, ...change } : c)),
    });
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === "none") return patch({ to: undefined });
    // From none, the first target, so the new mode shows its editor.
    const first = Array.isArray(to)
      ? to[0]?.stage
      : (to ?? targets[0] ?? "end");
    if (next === "one") return patch({ to: first });
    patch({ to: first ? [{ stage: first, when: "" }] : undefined });
  };
  return (
    <View style={styles.details}>
      <SettingsCard>
        <SettingsSelect<Mode>
          label={s.transitions}
          value={mode}
          options={[
            { value: "none", label: s.transitionsNone },
            { value: "one", label: s.transitionsOne },
            { value: "many", label: s.transitionsMany },
          ]}
          onValueChange={switchMode}
        />
        {typeof to === "string" ? (
          <SettingsSelect<string>
            label={s.nextStage}
            value={to}
            options={options(targets.includes(to) ? targets : [...targets, to])}
            onValueChange={(target) => patch({ to: target })}
          />
        ) : null}
      </SettingsCard>
      {conditions.map((condition, index) => (
        <View
          key={index}
          style={[styles.card, { borderColor: theme.colors.border }]}
        >
          <SettingsSelect<string>
            label={s.nextStage}
            value={condition.stage}
            options={options(
              targets.includes(condition.stage)
                ? targets
                : [...targets, condition.stage],
            )}
            onValueChange={(stageId) => setCondition(index, { stage: stageId })}
          />
          <TextInput
            accessibilityLabel={s.when}
            placeholder={s.when}
            placeholderTextColor={theme.colors.foregroundMuted}
            value={condition.when}
            onChangeText={(when) => setCondition(index, { when })}
            multiline
            style={inputStyle(theme)}
          />
          <ActionButton
            label={s.remove}
            theme={theme}
            onPress={() => {
              const kept = conditions.filter((_, i) => i !== index);
              patch({ to: kept.length ? kept : undefined });
            }}
          />
        </View>
      ))}
      {mode === "many" ? (
        <ActionButton
          label={s.addCondition}
          theme={theme}
          onPress={() =>
            patch({
              to: [...conditions, { stage: targets[0] ?? "end", when: "" }],
            })
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  toolbar: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  autonomy: { gap: 4 },
  startTag: { alignSelf: "flex-start", paddingVertical: 2 },
  handle: {
    position: "absolute",
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    borderWidth: 2,
    zIndex: 3,
  },
  dot: {
    position: "absolute",
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    zIndex: 4,
  },
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
