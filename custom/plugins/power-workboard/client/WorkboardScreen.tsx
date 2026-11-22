import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import {
  ExternalLink,
  SettingsCard,
  SettingsInput,
  SettingsAction,
  SettingsSelect,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import {
  copyText,
  Icon,
  Modal,
  ScrollView,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import {
  defaultWorkspaceGroup,
  defaultStartWorkGroup,
  groupKind,
  isDraftGroup,
  isTerminalGroup,
  orderedGroups,
  type Board,
  type Card,
  type Group,
  type Settings,
  type Stage,
  type FinishStep,
  type TaskTiming,
  type PackageRun,
  type PackageView,
} from "../shared/model";
import {
  defaultAtText,
  formatLocalDateTime,
  parseLocalDateTime,
} from "./timing";
import {
  CANCEL_BINDING_BUSY_ERROR_CODE,
  mutateRpc,
  redeployPaseoRpc,
  saveImageRpc,
  snapshotRpc,
  taskDescriptionsRpc, // CUSTOM(task-description-files)
  packageRunsRpc,
  type Mutation,
} from "../shared/rpc";
import { assistantAskRpc, assistantPmCardsRpc } from "../shared/assistant-rpc"; // CUSTOM(pm-board, packages)
import {
  attentionReasons,
  agentGone,
  cardAgentId,
  finishButtons,
  finishInlineLayout,
  groupDeleteReason,
  mappingPreview,
  shortDate,
  splitTitleArea,
  archiveListCards,
  archiveOutcomes,
  archivedBoardCards,
  archivedByColumn,
  isArchivedOffBoard,
  visibleCards,
  withOptimisticStages,
  cardsForStage,
} from "./board-utils";
import { groupTitle, stageTitle, strings } from "./strings";
import { FactoryLine } from "./FactoryLine"; // CUSTOM(factory)
import {
  limitLine,
  logLines,
  progressBadge,
  waitingLine,
} from "./checkpoint-format"; // CUSTOM(task-checkpoints)
import { GroupEditor, GroupSettings, newGroup } from "./GroupSettings";
import { factoryOwnsConfig } from "./FactoryLine"; // CUSTOM(factory)
import { BoardView } from "./BoardView";
import { ArchivedBoardCard } from "./ArchivedBoardCard";
import { cardMenuItems } from "./card-menu"; // CUSTOM(task-panel)
import {
  clampPanelWidth,
  loadPanelWidth,
  middleClickPanel,
  openPanel,
  panelCardFor,
  savePanelWidth,
  type PanelState,
} from "./task-panel-state"; // CUSTOM(task-panel)
import {
  groupColor,
  projectAccentColor,
  projectLetterFill,
  supplementalColor,
} from "./colors";
import { ProjectIcon } from "./ProjectIcon";
import { PipelinesView } from "./PipelinesView"; // CUSTOM(factory)
import {
  projectIconFor,
  useProjectIcons,
  type ProjectIcons,
} from "./project-icons";
import {
  loadBoardFilters,
  onEscapeKey,
  saveBoardFilters,
  toggleButtonState,
} from "./web";
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  type BoardFilters,
} from "./filters";
import { FilterPanel } from "./FilterPanel";
import { PackagesView } from "./PackagesView"; // CUSTOM(packages)
import { PackageMenu } from "./PackageMenu"; // CUSTOM(packages)
import { PackageDetail } from "./PackageDetail"; // CUSTOM(packages)
import { PackageAdjust } from "./PackageAdjust"; // CUSTOM(packages)
import {
  EMPTY_SELECTION,
  clearSelection,
  longPressCard,
  marqueeSelection,
  pressCard,
  selectionModifiers,
  type SelectionModifiers,
  type SelectionState,
} from "./selection"; // CUSTOM(packages)
import { effectiveTestTier } from "../shared/packages"; // CUSTOM(packages)
import { canAssignPackage } from "./package-drag"; // CUSTOM(packages)
import {
  newOrchestrator,
  ASSISTANT_TAB,
  OrchestratorsPanel,
  OrchestratorTab,
  WorkboardTabs,
} from "./Orchestrators";
import { QuickCreate } from "./QuickCreate";
import { HintButton, HintProvider } from "./Hint";
import { usePaseoLanguage } from "./paseo-language";
import { AssistantProfileTab } from "./Profiles"; // CUSTOM(agent-profiles)
import { optionAnswer } from "../shared/card-answers";
import { taskNumberLabel } from "../shared/task-reference"; // CUSTOM(delete-task)
import { ConfirmationModal } from "./ConfirmationModal";
// CUSTOM(task-panel)
import {
  CardContextMenu,
  TaskPanel,
  useCardPointerActions,
  useMiddleClick,
  type CardMenuRequest,
} from "./TaskPanel";
// CUSTOM(workboard-inner-pages): the Project Manager pages, as tabs of the board.
import { ChatLauncher } from "./assistant/ChatLauncher";
import { ConversationsScreen } from "./assistant/ConversationsScreen";
import { DashboardScreen } from "./assistant/DashboardScreen";
import { PmBoardScreen } from "./assistant/pm-board/PmBoardScreen"; // CUSTOM(pm-board)
import { ReportsScreen } from "./assistant/ReportsScreen";
import {
  reportTab,
  requestedTab,
  tabRequestKey,
  withPageNavigation,
} from "./assistant/workboard-pages";
// CUSTOM(workboard-images)
import { DescriptionImages } from "./DescriptionImages";
// CUSTOM(task-description-files)
import {
  taskDescriptionQuery,
  useSearchDescriptions,
} from "./task-description";
import {
  blobToBase64,
  pickImages,
  useImagePaste,
  type PastedImages,
} from "./image-paste";
import {
  IMAGE_MAX_BYTES,
  insertImageRefs,
  removeImageRef,
} from "../shared/images";

type Page = "board" | "archive" | "settings";
// CUSTOM(plugin-modal-size): our Paseo sizes it to 80% of the window; the published types lack it.
const LARGE_MODAL = { size: "large" } as object;
type DraftForm = {
  task?: Card;
  title: string;
  description: string;
  projectId: string | null;
  orchestratorId?: string | null;
  timing?: TaskTiming | null;
  /** Where a new task goes: a To do group or Ready to start. */
  stage?: Stage;
} | null;
type StartForm = { card: Card; stage?: Stage } | null;
type MoveUndo = {
  group: Pick<Group, "id" | "kind" | "label">;
  card: Card;
  expiresAt: number;
};
const sameUndoGroup = (board: Board | undefined, undo: MoveUndo) => {
  const current = board?.settings.groups.find(
    (group) => group.id === undo.group.id,
  );
  return (
    !!current &&
    current.kind === undo.group.kind &&
    current.label === undo.group.label
  );
};
const sameCard = (left: Card | undefined, right: Card) =>
  !!left && JSON.stringify(left) === JSON.stringify(right);

export function WorkboardScreen(
  props: PluginSurfaceProps & { initialPage?: Page },
) {
  return (
    <HintProvider key={props.host.id} theme={props.theme}>
      <HostWorkboard {...props} />
    </HintProvider>
  );
}

function HostWorkboard(props: PluginSurfaceProps & { initialPage?: Page }) {
  const callSnapshot = useRpc(snapshotRpc);
  const callMutation = useRpc(mutateRpc);
  const callRedeploy = useRpc(redeployPaseoRpc); // CUSTOM(redeploy-button)
  const callDescriptions = useRpc(taskDescriptionsRpc); // CUSTOM(task-description-files)
  const [confirmingRedeploy, setConfirmingRedeploy] = useState(false);
  const [redeployResult, setRedeployResult] = useState<{
    ok: boolean;
    output: string;
  } | null>(null);
  const cache = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState<Page>(props.initialPage ?? "board");
  // CUSTOM(workboard-inner-pages): the tab the host asks for (the Desk remembers the last one).
  // The pinned plugin types have no `params`, hence the cast.
  const params = (props as { params?: unknown }).params;
  const requested = requestedTab(params);
  const requestKey = tabRequestKey(params);
  // "board", "orchestrators", a Project Manager page, or the id of an orchestrator opened in
  // its own tab.
  const [tab, setTab] = useState(requested ?? "board");
  // CUSTOM(workboard-inner-pages): the assistant chat tab opens the chat and returns here.
  const returnTab = useRef("board");
  const selectTab = useCallback((next: string) => {
    setPage("board");
    setTab(next);
  }, []);
  // Keyed on the request, so the same tab asked for again (a repeated Command Center open) also
  // switches back to it.
  useEffect(() => {
    if (requested) selectTab(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, selectTab]);
  useEffect(() => {
    if (tab !== "assistant-chat") returnTab.current = tab;
    reportTab(props.navigation, tab);
  }, [props.navigation, tab]);
  const pageNavigation = useMemo(
    () => withPageNavigation(props.navigation, selectTab),
    [props.navigation, selectTab],
  );
  const [openOrchestrators, setOpenOrchestrators] = useState<string[]>([]);
  const [filters, setFilters] = useState(() => loadBoardFilters(props.host.id));
  const [filtersOpen, setFiltersOpen] = useState(false);
  // CUSTOM(packages): the Packages view, multiple selection, the package menu/detail and the undo
  // of an assignment.
  const [viewMode, setViewMode] = useState<"columns" | "packages">("columns");
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [packageMenu, setPackageMenu] = useState<{
    taskIds: string[];
  } | null>(null);
  const [packageDetailId, setPackageDetailId] = useState<string | null>(null);
  const [packageAdjustId, setPackageAdjustId] = useState<string | null>(null);
  const [packageUndo, setPackageUndo] = useState<{
    packageId: string;
    created: boolean;
    name: string;
    previous: { taskId: string; packageId: string | null }[];
  } | null>(null);
  useEffect(() => {
    if (!packageUndo) return;
    const timer = setTimeout(() => setPackageUndo(null), 12_000);
    return () => clearTimeout(timer);
  }, [packageUndo]);
  useEffect(() => {
    if (!selection.ids.size) return;
    return onEscapeKey(() => setSelection(clearSelection()));
  }, [selection.ids.size]);
  const storageWarned = useRef(false);
  const { projectId, search, attentionOnly } = filters;
  const [selectedStage, setSelectedStage] = useState<Stage | null>(null);
  const [draft, setDraft] = useState<DraftForm>(null);
  const [starting, setStarting] = useState<StartForm>(null);
  const [statusCard, setStatusCard] = useState<Card | null>(null);
  // CUSTOM(task-panel): one side panel at a time, plus the card's context menu.
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [panelWidth, setPanelWidth] = useState(() =>
    loadPanelWidth(props.host.id),
  );
  // CUSTOM(pm-board): a task link on a decision card opens that ticket in the side panel.
  const requestedTaskId = (params as { task?: unknown } | undefined)?.task;
  useEffect(() => {
    if (typeof requestedTaskId === "string" && requestedTaskId)
      setPanel(openPanel(requestedTaskId, "ticket", null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, requestedTaskId]);
  const [cardMenu, setCardMenu] = useState<CardMenuRequest | null>(null);
  const rootRef = useRef<View>(null);
  const [rootSize, setRootSize] = useState({ width: 0, height: 0 });
  const windowSize = useWindowDimensions();
  const menuViewport =
    Platform.OS === "web"
      ? { width: windowSize.width, height: windowSize.height }
      : rootSize;
  const [restoringArchived, setRestoringArchived] = useState<Card | null>(null);
  const [archivingDraft, setArchivingDraft] = useState<Card | null>(null);
  const [deletingTask, setDeletingTask] = useState<Card | null>(null); // CUSTOM(delete-task)
  const [detachingDraft, setDetachingDraft] = useState<{
    card: Card;
    draftId: string;
  } | null>(null);
  const [cancelingBinding, setCancelingBinding] = useState<Card | null>(null);
  const [pendingMutationIds, setPendingMutationIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [moveUndos, setMoveUndos] = useState<Map<string, MoveUndo>>(
    () => new Map(),
  );
  const [optimisticCardOrders, setOptimisticCardOrders] = useState<
    Record<string, string[]>
  >({});
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const [editingGroup, setEditingGroup] = useState<{
    group: Group;
    settings: Settings;
    revision: number;
  } | null>(null);
  const [optimisticStages, setOptimisticStages] = useState<Map<string, Stage>>(
    () => new Map(),
  );
  const boardQuery = useQuery({
    queryKey: ["power-workboard", props.host.id],
    queryFn: () => callSnapshot({}),
    refetchInterval: 1_500,
  });
  // CUSTOM(task-description-files): the search matches descriptions, read only while it has text.
  const searchDescriptions = useSearchDescriptions(
    (boardQuery.data?.cards ?? []).filter(
      (card) => filters.showArchived || !isArchivedOffBoard(card),
    ),
    search.trim().length > 0,
  );
  // CUSTOM(packages): the gate history is only read while a package detail is open.
  const callPackageRuns = useRpc(packageRunsRpc);
  const callAsk = useRpc(assistantAskRpc);
  const packageRunsQuery = useQuery({
    queryKey: [
      "power-workboard",
      "package-runs",
      props.host.id,
      packageDetailId,
    ],
    queryFn: () => callPackageRuns({ packageId: packageDetailId as string }),
    enabled: !!packageDetailId,
    refetchInterval: 2_000,
  });
  // CUSTOM(pm-board): the count on the Decisões tab. The page polls its own cards; this only
  // needs the number waiting for the user.
  const callPmCards = useRpc(assistantPmCardsRpc);
  const pmCardsQuery = useQuery({
    queryKey: ["power-workboard", "pm-board", props.host.id, "badge"],
    queryFn: () => callPmCards({}),
    refetchInterval: 15_000,
  });
  const pmWaiting =
    pmCardsQuery.data?.cards.filter((card) => card.status === "waiting")
      .length ?? 0;
  const serverBoard = boardQuery.data;
  // CUSTOM(project-icon-colors): the images the cards and project lists draw.
  const projectIcons = useProjectIcons(
    props.host.id,
    serverBoard?.projects ?? [],
  );
  const language = usePaseoLanguage();
  const t = strings(language);
  const mutationPending = useRef(new Set<string>());
  const liveBoard = useRef(serverBoard);
  liveBoard.current = serverBoard;
  const liveUndos = useRef(moveUndos);
  liveUndos.current = moveUndos;
  const filterValues = useRef(filters);
  const filterSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterDirty = useRef(false);
  const persistFilters = useCallback(() => {
    filterDirty.current = false;
    if (
      !saveBoardFilters(props.host.id, filterValues.current) &&
      !storageWarned.current
    ) {
      storageWarned.current = true;
      toast.show(t.filterSaveFailed, { variant: "warning" });
    }
  }, [props.host.id, toast, t.filterSaveFailed]);
  useEffect(
    () => () => {
      if (filterSave.current) clearTimeout(filterSave.current);
      if (filterDirty.current) persistFilters();
    },
    [persistFilters],
  );
  useEffect(() => {
    const prune = () =>
      setMoveUndos((current) => {
        const next = new Map(
          [...current].filter(
            ([id, undo]) =>
              undo.expiresAt > Date.now() &&
              sameUndoGroup(liveBoard.current, undo) &&
              sameCard(
                liveBoard.current?.cards.find((card) => card.id === id),
                undo.card,
              ),
          ),
        );
        liveUndos.current = next;
        return next.size === current.size ? current : next;
      });
    prune();
    if (!moveUndos.size) return;
    const timer = setTimeout(
      prune,
      Math.max(
        0,
        Math.min(...[...moveUndos.values()].map((undo) => undo.expiresAt)) -
          Date.now(),
      ),
    );
    return () => clearTimeout(timer);
  }, [serverBoard, moveUndos]);
  const writeEligible = useRef(false);
  const updateFilters = useCallback(
    (patch: Partial<BoardFilters>) => {
      const next = { ...filterValues.current, ...patch };
      filterValues.current = next;
      setFilters(next);
      filterDirty.current = true;
      if (filterSave.current) clearTimeout(filterSave.current);
      filterSave.current = setTimeout(() => {
        filterSave.current = null;
        persistFilters();
      }, 300);
    },
    [persistFilters],
  );
  useEffect(() => {
    if (
      serverBoard?.connected &&
      projectId !== "all" &&
      projectId !== "none" &&
      !serverBoard.projects.some((project) => project.id === projectId)
    )
      updateFilters({ projectId: "all" });
  }, [projectId, serverBoard?.connected, serverBoard?.projects, updateFilters]);
  writeEligible.current = !!serverBoard?.connected && !boardQuery.isError;
  const mutate = useCallback(
    async (
      mutation: Mutation,
      pendingMutationId = "taskId" in mutation
        ? `${mutation.action}:${mutation.taskId}`
        : mutation.action,
    ) => {
      if (mutationPending.current.has(pendingMutationId)) {
        toast.error(t.mutationPending);
        return undefined;
      }
      if (!writeEligible.current) {
        toast.error(t.disconnected);
        return undefined;
      }
      mutationPending.current.add(pendingMutationId);
      setPendingMutationIds(new Set(mutationPending.current));
      try {
        const next = await callMutation(mutation);
        await cache.cancelQueries({
          queryKey: ["power-workboard", props.host.id],
        });
        cache.setQueryData<Board>(
          ["power-workboard", props.host.id],
          (previous) =>
            previous && previous.revision > next.revision ? previous : next,
        );
        return next;
      } catch (error) {
        toast.error(mutationErrorText(error, t));
        return undefined;
      } finally {
        mutationPending.current.delete(pendingMutationId);
        setPendingMutationIds(new Set(mutationPending.current));
      }
    },
    [cache, callMutation, props.host.id, t, toast],
  );
  // CUSTOM(packages): a PM suggestion's "Select these tickets" opens the board with them
  // selected and the package menu ready; it creates nothing. Above the loading returns below
  // (a hook after them changes the hook count once the board arrives), and it runs again when
  // the board first loads.
  const requestedSelect = (params as { select?: unknown } | undefined)?.select;
  const requestedPackageMenu = (params as { packageMenu?: unknown } | undefined)
    ?.packageMenu;
  const boardLoaded = !!serverBoard;
  useEffect(() => {
    if (!serverBoard) return;
    if (typeof requestedSelect !== "string" || !requestedSelect) return;
    const known = new Set(serverBoard.cards.map((card) => card.id));
    const ids = requestedSelect.split(",").filter((id) => known.has(id));
    if (!ids.length) return;
    setSelection({ ids: new Set(ids), anchor: ids[ids.length - 1]! });
    if (requestedPackageMenu === "1") setPackageMenu({ taskIds: ids });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, requestedSelect, requestedPackageMenu, boardLoaded]);
  if (boardQuery.isPending)
    return <Centered theme={props.theme} text={t.loading} />;
  if (!serverBoard)
    return (
      <Centered
        theme={props.theme}
        text={t.loadError}
        action={t.refresh}
        onPress={() => void boardQuery.refetch()}
      />
    );
  const board = withOptimisticStages(
    {
      ...serverBoard,
      cardOrderByStage: {
        ...serverBoard.cardOrderByStage,
        ...optimisticCardOrders,
      },
    },
    optimisticStages,
  );
  const cards = visibleCards(
    board,
    projectId,
    search,
    attentionOnly,
    filters,
    searchDescriptions,
  );
  const archivedCards = archivedBoardCards(
    board,
    projectId,
    search,
    attentionOnly,
    filters,
    searchDescriptions,
  );
  const filterCount = activeFilterCount(filters);
  const hasActiveFilter = filterCount > 0;
  // CUSTOM(packages): selection and package actions. The board snapshot updates optimistically
  // through `mutate`, so the chips appear as soon as the mutation answers.
  const selectedCards = board.cards.filter((card) =>
    selection.ids.has(card.id),
  );
  const selectCard = (
    card: Card,
    event: { nativeEvent?: SelectionModifiers },
  ) => {
    const order = cardsForStage(
      board.cards,
      card.stage as Stage,
      board.cardOrderByStage,
    ).map((item) => item.id);
    setSelection(
      pressCard(
        selection,
        card.id,
        selectionModifiers(event),
        order,
        selection.ids.size > 0,
      ),
    );
  };
  const selectOnLongPress = (card: Card) => {
    setSelection(longPressCard(selection, card.id));
  };
  const rememberPackageUndo = (
    taskIds: readonly string[],
    packageId: string,
    created: boolean,
    name: string,
  ) =>
    setPackageUndo({
      packageId,
      created,
      name,
      previous: taskIds.map((taskId) => ({
        taskId,
        packageId:
          board.cards.find((card) => card.id === taskId)?.packageId ?? null,
      })),
    });
  const createPackage = async (name: string) => {
    const taskIds = packageMenu?.taskIds ?? [];
    const projectIds = new Set(
      taskIds.map(
        (id) => board.cards.find((card) => card.id === id)?.projectId ?? null,
      ),
    );
    if (projectIds.size !== 1 || projectIds.has(null)) {
      toast.error(t.packages.addToPackage);
      return;
    }
    const projectId = [...projectIds][0] as string;
    const next = await mutate(
      { action: "package-create", name, projectId, taskIds },
      "package-create",
    );
    if (!next) return;
    const created = next.packages.find(
      (pkg) => pkg.name === name && pkg.projectId === projectId,
    );
    if (created) rememberPackageUndo(taskIds, created.id, true, name);
    setSelection(clearSelection());
    setPackageMenu(null);
  };
  const assignPackage = async (packageId: string) => {
    const taskIds = packageMenu?.taskIds ?? [];
    const pkg = board.packages.find((item) => item.id === packageId);
    const next = await mutate(
      { action: "package-assign", packageId, taskIds },
      "package-assign",
    );
    if (!next) return;
    if (pkg) rememberPackageUndo(taskIds, packageId, false, pkg.name);
    setSelection(clearSelection());
    setPackageMenu(null);
  };
  // CUSTOM(packages): a card dropped on a package rail joins it; on "No package", it leaves.
  const dropCardOnPackage = async (
    packageId: string | null,
    cardId: string,
  ) => {
    const card = board.cards.find((item) => item.id === cardId);
    // A click on a card in its own rail is not a move, and would reset its test level.
    if (!canAssignPackage(card?.packageId ?? null, packageId)) return;
    if (!packageId) {
      await removeFromPackage([cardId]);
      return;
    }
    const pkg = board.packages.find((item) => item.id === packageId);
    const next = await mutate(
      { action: "package-assign", packageId, taskIds: [cardId] },
      `package-assign:${cardId}`,
    );
    if (next && pkg) rememberPackageUndo([cardId], packageId, false, pkg.name);
  };
  const removeFromPackage = async (taskIds: readonly string[]) => {
    const next = await mutate(
      { action: "package-remove", taskIds: [...taskIds] },
      "package-remove",
    );
    if (next) {
      setSelection(clearSelection());
      setPackageMenu(null);
    }
  };
  const undoPackage = async () => {
    if (!packageUndo) return;
    for (const item of packageUndo.previous) {
      if (item.packageId)
        await mutate(
          {
            action: "package-assign",
            packageId: item.packageId,
            taskIds: [item.taskId],
          },
          `package-undo:${item.taskId}`,
        );
      else
        await mutate(
          { action: "package-remove", taskIds: [item.taskId] },
          `package-undo:${item.taskId}`,
        );
    }
    if (packageUndo.created)
      await mutate(
        { action: "package-delete", packageId: packageUndo.packageId },
        "package-delete",
      );
    setPackageUndo(null);
  };
  const askPmToGroup = async (taskIds: readonly string[]) => {
    const numbers = taskIds
      .map((id) => board.cards.find((card) => card.id === id)?.number)
      .filter((number): number is number => typeof number === "number")
      .map((number) => `#${number}`)
      .join(", ");
    setPackageMenu(null);
    try {
      await callAsk({
        text: `Group ${numbers} into a package and propose the grouping on your board. Do not create it without my ok.`,
        source: "package-menu",
        waitMs: 0,
      });
      toast.show(t.packages.askPmToGroup, { variant: "success" });
    } catch {
      toast.error(t.packages.askPmToGroup);
    }
  };
  const proposePackageClose = async (pkg: PackageView) => {
    setPackageDetailId(null);
    try {
      await callAsk({
        text: `Propose closing package "${pkg.name}" (${pkg.id}) on your board with a "Close the package?" card. Do not close it without my ok.`,
        source: "package-detail",
        waitMs: 0,
      });
      toast.show(t.packages.proposedClose, { variant: "success" });
    } catch {
      toast.error(t.packages.proposedClose);
    }
  };
  const runPackageGate = async (packageId: string) => {
    const next = await mutate(
      { action: "package-run-gate", packageId },
      "package-run-gate",
    );
    if (next) toast.show(t.packages.runGate, { variant: "success" });
  };
  const closePackage = async (packageId: string) => {
    const next = await mutate(
      { action: "package-close", packageId, runGate: true },
      "package-close",
    );
    if (next) setPackageDetailId(null);
  };
  const updatePackage = async (
    packageId: string,
    patch: {
      name?: string;
      night?: boolean;
      onClose?: boolean;
      branch?: string | null;
    },
  ) => {
    const pkg = board.packages.find((item) => item.id === packageId);
    if (!pkg) return;
    const next = await mutate(
      {
        action: "package-update",
        packageId,
        name: patch.name,
        branch: patch.branch,
        trigger:
          patch.night === undefined && patch.onClose === undefined
            ? undefined
            : {
                night: patch.night ?? pkg.trigger.night,
                onClose: patch.onClose ?? pkg.trigger.onClose,
                everyMerges: pkg.trigger.everyMerges,
              },
      },
      "package-update",
    );
    if (next) setPackageAdjustId(null);
  };
  const allCards = visibleCards(board, "all", "", false);
  const conflicts = cards.filter((card) => card.stage === "conflict");
  const archived = archiveListCards(board.cards);
  // CUSTOM(task-panel): one ticket at a time; switching replaces the panel's content.
  const panelCard = panelCardFor(board.cards, panel?.taskId ?? null);
  // CUSTOM(packages)
  const packageDetail =
    board.packages.find((pkg) => pkg.id === packageDetailId) ?? null;
  const packageAdjust =
    board.packages.find((pkg) => pkg.id === packageAdjustId) ?? null;
  const packageMenuProjectId = packageMenu
    ? (board.cards.find((card) => card.id === packageMenu.taskIds[0])
        ?.projectId ?? null)
    : null;
  const writesDisabled = !board.connected || boardQuery.isError;
  const groupsPending = pendingMutationIds.has("settings:groups");
  const draftPending = pendingMutationIds.has(
    draft?.task ? `edit:${draft.task.id}` : "create",
  );
  const startPending =
    !!starting && pendingMutationIds.has(`start:${starting.card.id}`);
  // CUSTOM(task-panel): touch positions are window-based; the native menu is absolute inside the
  // board root, so convert them once, here.
  const openCardMenu = (request: CardMenuRequest) => {
    if (Platform.OS === "web" || !rootRef.current) {
      setCardMenu(request);
      return;
    }
    rootRef.current.measureInWindow((x, y) => {
      setCardMenu({ ...request, x: request.x - x, y: request.y - y });
    });
  };
  const openAgent = (agentId: string, card?: Card) => {
    // CUSTOM(task-panel): a settled task whose agent was deleted has nothing to open.
    if (
      card &&
      agentGone(
        card,
        agentId,
        groupKind(card.stage, board.settings.groups) === "done" ||
          card.archived !== null,
      )
    ) {
      toast.error(t.agentGone);
      return;
    }
    if (!props.navigation) {
      toast.error(t.navigationUnavailable);
      return;
    }
    props.navigation.openAgent({ agentId, serverId: board.serverId });
  };
  const openOrchestrator = (id: string) => {
    setOpenOrchestrators((open) => (open.includes(id) ? open : [...open, id]));
    setTab(id);
  };
  const closeOrchestrator = (id: string) => {
    setOpenOrchestrators((open) => open.filter((item) => item !== id));
    if (tab === id) setTab("orchestrators");
    if (returnTab.current === id) returnTab.current = "orchestrators";
  };
  const shutdownAt = board.nightRuntime.shutdownAt;
  // CUSTOM(redeploy-button): on the right of the tab row, on every tab.
  const redeployButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.redeployPaseo}
      disabled={writesDisabled}
      onPress={() => setConfirmingRedeploy(true)}
      style={({ pressed }) => [
        styles.toolbarButton,
        styles.redeployButton,
        { borderColor: props.theme.colors.border },
        {
          opacity: writesDisabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Icon
        name="RefreshCw"
        size={16}
        color={props.theme.colors.foregroundMuted}
      />
      {!props.layout.compact && (
        <Text
          style={[
            styles.controlText,
            { color: props.theme.colors.foregroundMuted },
          ]}
        >
          {t.redeployPaseo}
        </Text>
      )}
    </Pressable>
  );
  const tabs = (
    <>
      {shutdownAt && (
        <ShutdownBanner
          at={shutdownAt}
          t={t}
          theme={props.theme}
          disabled={writesDisabled}
          onCancel={() => void mutate({ action: "night-shutdown-cancel" })}
        />
      )}
      <WorkboardTabs
        trailing={redeployButton} // CUSTOM(redeploy-button)
        badges={{ "pm-board": pmWaiting }} // CUSTOM(pm-board)
        board={board}
        t={t}
        theme={props.theme}
        tab={tab}
        open={openOrchestrators.filter(
          (id) =>
            id === ASSISTANT_TAB ||
            board.orchestrators.some((o) => o.id === id),
        )}
        onSelect={selectTab}
        onClose={closeOrchestrator}
      />
      {/* CUSTOM(redeploy-button) */}
      {redeployResult && (
        <View style={styles.filterSummary}>
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.notice,
              {
                flex: 1,
                color: redeployResult.ok
                  ? props.theme.colors.foregroundMuted
                  : props.theme.colors.statusWarning,
              },
            ]}
          >
            {redeployResult.output}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.dismiss}
            onPress={() => setRedeployResult(null)}
            style={styles.toolbarButton}
          >
            <Icon
              name="X"
              size={14}
              color={props.theme.colors.foregroundMuted}
            />
          </Pressable>
        </View>
      )}
      {confirmingRedeploy && (
        <ConfirmationModal
          title={t.redeployPaseo}
          description={t.redeployPaseoConfirm}
          confirmLabel={t.redeployPaseo}
          disabled={writesDisabled}
          t={t}
          theme={props.theme}
          onClose={() => setConfirmingRedeploy(false)}
          onConfirm={async () => {
            try {
              setRedeployResult(await callRedeploy({}));
            } catch {
              setRedeployResult({ ok: false, output: t.redeployPaseoFailed });
            }
            return true;
          }}
        />
      )}
    </>
  );
  if (page === "board" && tab !== "board") {
    const shared = {
      board,
      t,
      theme: props.theme,
      disabled: writesDisabled,
      mutate,
      onOpenAgent: openAgent,
    };
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: props.theme.colors.surface0 },
        ]}
      >
        {tabs}
        {tab === "orchestrators" ? (
          <OrchestratorsPanel
            {...shared}
            onOpen={openOrchestrator}
            onCreate={async () => {
              const before = new Set(board.orchestrators.map((o) => o.id));
              const next = await mutate({
                action: "orchestrator-save",
                orchestrator: newOrchestrator(board, t),
              });
              const created = next?.orchestrators.find(
                (o) => !before.has(o.id),
              );
              if (created) openOrchestrator(created.id);
            }}
          />
        ) : tab === "pipelines" ? (
          // CUSTOM(factory): the pipelines and their editor. A task in the live overlay opens its
          // ticket in the board's side panel, which only the board tab renders.
          <PipelinesView
            board={board}
            theme={props.theme}
            compact={props.layout.compact}
            onError={(error) => toast.error(mutationErrorText(error, t))}
            onOpenCard={(cardId) => {
              setPanel(openPanel(cardId, "ticket", null));
              selectTab("board");
            }}
          />
        ) : tab === "assistant-chat" ? (
          // CUSTOM(workboard-inner-pages): the same screens the Desk chips used to show.
          <ChatLauncher
            {...props}
            navigation={pageNavigation}
            onOpened={() => selectTab(returnTab.current)}
          />
        ) : tab === "pm-board" ? (
          // CUSTOM(pm-board): the PM's own board, apart from the code tasks.
          <PmBoardScreen {...props} navigation={pageNavigation} />
        ) : tab === "dashboard" ? (
          <View style={styles.screen}>
            <DashboardScreen {...props} navigation={pageNavigation} />
          </View>
        ) : tab === "conversations" ? (
          <ConversationsScreen {...props} navigation={pageNavigation} />
        ) : tab === "reports" ? (
          <ReportsScreen {...props} navigation={pageNavigation} />
        ) : tab === ASSISTANT_TAB ? (
          <AssistantProfileTab
            theme={props.theme}
            disabled={writesDisabled}
            factoryOwned={factoryOwnsConfig(board.factory)}
          /> // CUSTOM(agent-profiles)
        ) : (
          <OrchestratorTab
            key={tab}
            {...shared}
            id={tab}
            onDeleted={() => closeOrchestrator(tab)}
          />
        )}
      </View>
    );
  }
  if (page === "archive")
    return (
      <ArchivePage
        board={board}
        cards={archived}
        t={t}
        theme={props.theme}
        disabled={writesDisabled}
        mutate={mutate}
        onBack={() => setPage("board")}
      />
    );
  if (page === "settings")
    return (
      <SettingsPage
        board={board}
        t={t}
        theme={props.theme}
        disabled={writesDisabled}
        saving={groupsPending}
        pendingMutationIds={pendingMutationIds}
        mutate={mutate}
        onBack={
          props.initialPage === "settings" ? undefined : () => setPage("board")
        }
      />
    );
  const setStage = async (card: Card, stage: Stage) => {
    if (mutationPending.current.has(`stage:${card.id}`)) {
      toast.error(t.mutationPending);
      return false;
    }
    if (
      card.workspaceId === null &&
      !isDraftGroup(stage, board.settings.groups)
    ) {
      setStatusCard(null);
      setStarting({ card, stage });
      return false;
    }
    setMoveUndos((current) => {
      const next = new Map(current);
      next.delete(card.id);
      liveUndos.current = next;
      return next;
    });
    setOptimisticStages((current) => new Map(current).set(card.id, stage));
    const next = await mutate({
      action: "stage",
      taskId: card.id,
      stage,
      expectedLabels: card.managedLabels,
    });
    setOptimisticStages((current) => {
      const updated = new Map(current);
      updated.delete(card.id);
      return updated;
    });
    if (next) {
      setStatusCard(null);
      const moved = next.cards.find((item) => item.id === card.id);
      const originalGroup = board.settings.groups.find(
        (group) => group.id === card.stage,
      );
      if (
        moved &&
        moved.stage === stage &&
        stage !== card.stage &&
        originalGroup
      ) {
        const undo = {
          group: {
            id: originalGroup.id,
            kind: originalGroup.kind,
            label: originalGroup.label,
          },
          card: moved,
          expiresAt: Date.now() + 8000,
        };
        setMoveUndos((current) => {
          const entries = new Map(current).set(card.id, undo);
          liveUndos.current = entries;
          return entries;
        });
      }
    }
    return !!next;
  };
  const undoMove = async (id: string) => {
    const undo = liveUndos.current.get(id);
    const card = liveBoard.current?.cards.find((item) => item.id === id);
    if (
      !undo ||
      undo.expiresAt <= Date.now() ||
      !sameCard(card, undo.card) ||
      !sameUndoGroup(liveBoard.current, undo)
    ) {
      toast.error(t.undoMoveExpired);
      return;
    }
    if (mutationPending.current.has(`stage:${id}`)) {
      toast.error(t.mutationPending);
      return;
    }
    const next = await mutate({
      action: "stage",
      taskId: id,
      stage: undo.group.id,
      expectedLabels: undo.card.managedLabels,
      expectedUpdatedAt: undo.card.updatedAt,
      expectedGroup: undo.group,
    });
    setMoveUndos((current) => {
      const entries = new Map(current);
      entries.delete(id);
      liveUndos.current = entries;
      return entries;
    });
    if (next) toast.show(t.moveUndone, { variant: "success" });
  };
  const saveCardOrder = async (
    input: Extract<Mutation, { action: "reorder-cards" | "reset-card-order" }>,
  ) => {
    const pendingId = `card-order:${input.stage}`;
    if (mutationPending.current.has(pendingId)) {
      toast.error(t.mutationPending);
      return false;
    }
    setOptimisticCardOrders((current) => ({
      ...current,
      [input.stage]: input.action === "reorder-cards" ? input.cardOrder : [],
    }));
    const next = await mutate(input, pendingId);
    setOptimisticCardOrders((current) => {
      const copy = { ...current };
      delete copy[input.stage];
      return copy;
    });
    if (!next) void boardQuery.refetch();
    return !!next;
  };
  const editGroup = (group: Group) =>
    setEditingGroup({
      group,
      settings: board.settings,
      revision: board.revision,
    });
  const deleteReason = (group: Group) => {
    const reason = groupDeleteReason(
      board.cards,
      board.settings.groups,
      group,
      board.settings,
    );
    return reason ? t[reason] : null;
  };
  const createTask = () =>
    setDraft({
      title: "",
      description: "",
      projectId: projectId === "all" || projectId === "none" ? null : projectId,
    });
  const clearFilters = () => updateFilters(DEFAULT_FILTERS);
  // CUSTOM(task-description-files): the editor opens once the description is read, so a save
  // never replaces a text it did not load.
  const editTask = async (card: Card) => {
    try {
      const { text } = await cache.fetchQuery(
        taskDescriptionQuery(callDescriptions, card),
      );
      setDraft({
        task: card,
        title: card.title,
        description: text,
        projectId: card.projectId,
        orchestratorId: card.orchestratorId,
        timing: card.timing,
      });
    } catch (failure) {
      toast.error(
        `${t.ticketPanel.descriptionFailed} ${failure instanceof Error ? failure.message : String(failure)}`,
      );
    }
  };
  const notifyTaskSaved = (next: Board, editedId?: string, quick = false) => {
    const saved = editedId
      ? next.cards.find((card) => card.id === editedId)
      : next.cards.find(
          (card) =>
            card.workspaceId === null &&
            !board.cards.some((existing) => existing.id === card.id),
        );
    const hidden =
      saved &&
      !visibleCards(
        next,
        projectId,
        search,
        attentionOnly,
        filters,
        searchDescriptions,
      ).some((card) => card.id === saved.id);
    const message = editedId
      ? hidden
        ? t.taskUpdatedHidden
        : t.taskUpdated
      : hidden
        ? t.quickCreatedHidden
        : quick
          ? t.quickCreated
          : t.taskCreated;
    toast.show(message, {
      variant: hidden ? "info" : "success",
      durationMs: hidden ? 6000 : 2500,
    });
  };
  // CUSTOM(packages): one renderer for the columns and the package rails.
  const renderTaskCard = (card: Card, dragHandle: ReactNode = null) => (
    <TaskCard
      card={card}
      board={board}
      icons={projectIcons}
      t={t}
      theme={props.theme}
      disabled={writesDisabled}
      pending={
        pendingMutationIds.has(`stage:${card.id}`) ||
        pendingMutationIds.has(`card-order:${card.stage}`)
      }
      compact={props.layout.compact}
      dragHandle={dragHandle}
      onUndo={moveUndos.has(card.id) ? () => undoMove(card.id) : undefined}
      onOpen={() => {
        if (!props.navigation) {
          toast.error(t.navigationUnavailable);
          return;
        }
        if (card.workspaceId)
          props.navigation.openWorkspace({
            workspaceId: card.workspaceId,
            serverId: board.serverId,
          });
      }}
      onEdit={() => void editTask(card)}
      onStart={() => setStarting({ card })}
      onOpenAgent={(agentId) => openAgent(agentId, card)}
      onRefine={async () => {
        const next = await mutate({
          action: "refine",
          taskId: card.id,
        });
        const agentId = next?.refinements[card.id]?.agentId;
        if (!agentId) return;
        if (!props.navigation) {
          toast.error(t.navigationUnavailable);
          return;
        }
        props.navigation.openAgent({
          agentId,
          serverId: board.serverId,
        });
      }}
      onReview={async (outcome, feedback) => {
        const next = await mutate({
          action: "review",
          taskId: card.id,
          outcome,
          feedback,
        });
        if (
          next &&
          outcome === "continue" &&
          next.orchestrations[card.id]?.status === "queued"
        )
          toast.show(t.review.queued);
        return !!next;
      }}
      onFinish={(step) =>
        void mutate({ action: "finish", taskId: card.id, step })
      }
      onStatus={() => setStatusCard(card)}
      onArchive={() => setArchivingDraft(card)}
      onDelete={() => setDeletingTask(card)}
      onCancelBinding={() => setCancelingBinding(card)}
      onDetachDraft={(draftId) => setDetachingDraft({ card, draftId })}
      onOpenPanel={() => setPanel(openPanel(card.id, "ticket", null))}
      onOpenAgentInPanel={(agentId) =>
        setPanel(
          middleClickPanel({ taskId: card.id, agentId, onAgentLink: true }),
        )
      }
      onContextMenu={openCardMenu}
      selected={selection.ids.has(card.id)}
      selectionActive={selection.ids.size > 0}
      onSelect={(event) => selectCard(card, event)}
      onLongPressSelect={() => selectOnLongPress(card)}
      packageName={
        board.packages.find((pkg) => pkg.id === card.packageId)?.name ?? null
      }
      testTier={effectiveTestTier(card)}
      suspect={board.packages.some((pkg) =>
        pkg.suspectTaskIds.includes(card.id),
      )}
      onAddToPackage={() => setPackageMenu({ taskIds: [card.id] })}
      onRemoveFromPackage={() => void removeFromPackage([card.id])}
      onAskPmToGroup={() =>
        void askPmToGroup(selectedCards.map((item) => item.id))
      }
      selectionCount={selection.ids.size}
    />
  );
  return (
    <View
      ref={rootRef}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setRootSize((current) =>
          current.width === width && current.height === height
            ? current
            : { width, height },
        );
      }}
      style={[styles.screen, { backgroundColor: props.theme.colors.surface0 }]}
    >
      {tabs}
      <View
        style={[styles.toolbar, { borderColor: props.theme.colors.border }]}
      >
        <View
          style={[
            styles.toolbarLeading,
            props.layout.compact && styles.toolbarLeadingCompact,
          ]}
        >
          <Pressable
            accessibilityRole="button"
            disabled={writesDisabled}
            onPress={createTask}
            style={({ pressed }) => [
              styles.toolbarButton,
              {
                backgroundColor: props.theme.colors.accent,
                opacity: writesDisabled ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}
          >
            <Icon
              name="Plus"
              size={16}
              color={props.theme.colors.accentForeground}
            />
            <Text
              style={[
                styles.controlText,
                { color: props.theme.colors.accentForeground },
              ]}
            >
              {t.addTask}
            </Text>
          </Pressable>
          <ProjectPicker
            board={board}
            icons={projectIcons}
            value={projectId}
            setValue={(projectId) => updateFilters({ projectId })}
            t={t}
            theme={props.theme}
            compact={props.layout.compact}
          />
        </View>
        <View
          style={[
            styles.search,
            {
              borderColor: props.theme.colors.border,
              backgroundColor: props.theme.colors.surface1,
            },
          ]}
        >
          <Icon
            name="Search"
            size={16}
            color={props.theme.colors.foregroundMuted}
          />
          <TextInput
            accessibilityLabel={t.search}
            value={search}
            onChangeText={(search) => updateFilters({ search })}
            placeholder={t.search}
            placeholderTextColor={props.theme.colors.foregroundMuted}
            style={[
              styles.searchInput,
              { color: props.theme.colors.foreground },
            ]}
          />
          {search.length > 0 && (
            <HintButton
              hint={t.clearSearch}
              accessibilityRole="button"
              accessibilityLabel={t.clearSearch}
              onPress={() => updateFilters({ search: "" })}
              style={styles.iconAction}
            >
              <Icon
                name="X"
                size={16}
                color={props.theme.colors.foregroundMuted}
              />
            </HintButton>
          )}
        </View>
        <View style={styles.toolbarActions}>
          <HintButton
            hint={t.attention}
            accessibilityRole="button"
            accessibilityLabel={t.attention}
            {...toggleButtonState(attentionOnly)}
            onPress={() => updateFilters({ attentionOnly: !attentionOnly })}
            style={({ pressed }) => [
              styles.toolbarButton,
              {
                backgroundColor: attentionOnly
                  ? props.theme.colors.accent
                  : pressed
                    ? props.theme.colors.surface2
                    : "transparent",
              },
            ]}
          >
            <Icon
              name="CircleAlert"
              size={16}
              color={
                attentionOnly
                  ? props.theme.colors.accentForeground
                  : props.theme.colors.foreground
              }
            />
            {!props.layout.compact && (
              <Text
                style={[
                  styles.controlText,
                  {
                    color: attentionOnly
                      ? props.theme.colors.accentForeground
                      : props.theme.colors.foreground,
                  },
                ]}
              >
                {t.attention}
              </Text>
            )}
          </HintButton>
          <HintButton
            hint={t.filters}
            accessibilityRole="button"
            accessibilityLabel={t.filters}
            accessibilityState={{ expanded: filtersOpen }}
            aria-expanded={filtersOpen}
            onPress={() => setFiltersOpen((value) => !value)}
            style={({ pressed }) => [
              styles.toolbarButton,
              {
                backgroundColor: filtersOpen
                  ? props.theme.colors.accent
                  : pressed
                    ? props.theme.colors.surface2
                    : "transparent",
              },
            ]}
          >
            <Icon
              name="SlidersHorizontal"
              size={16}
              color={
                filtersOpen
                  ? props.theme.colors.accentForeground
                  : props.theme.colors.foreground
              }
            />
            {props.layout.compact ? (
              filterCount > 0 && (
                <View
                  testID="workboard-filter-count"
                  style={[
                    styles.filterBadge,
                    { backgroundColor: props.theme.colors.accent },
                  ]}
                >
                  <Text
                    style={[
                      styles.cardMeta,
                      { color: props.theme.colors.accentForeground },
                    ]}
                  >
                    {filterCount}
                  </Text>
                </View>
              )
            ) : (
              <Text
                style={[
                  styles.controlText,
                  {
                    color: filtersOpen
                      ? props.theme.colors.accentForeground
                      : props.theme.colors.foreground,
                  },
                ]}
              >
                {`${t.filters}${filterCount ? ` (${filterCount})` : ""}`}
              </Text>
            )}
          </HintButton>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t.archive} (${archived.length})`}
            onPress={() => setPage("archive")}
            style={({ pressed }) => [
              styles.toolbarButton,
              pressed && { backgroundColor: props.theme.colors.surface2 },
            ]}
          >
            <Icon
              name="Archive"
              size={16}
              color={props.theme.colors.foregroundMuted}
            />
            <Text
              style={[
                styles.controlText,
                { color: props.theme.colors.foregroundMuted },
              ]}
            >
              {props.layout.compact
                ? archived.length
                : `${t.archive} (${archived.length})`}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.settings}
            onPress={() => setPage("settings")}
            style={({ pressed }) => [
              styles.toolbarButton,
              pressed && { backgroundColor: props.theme.colors.surface2 },
            ]}
          >
            <Icon
              name="Settings"
              size={16}
              color={props.theme.colors.foregroundMuted}
            />
          </Pressable>
        </View>
      </View>
      {/* CUSTOM(packages): the board view toggle, the selection bar and the assignment undo. */}
      <View style={styles.packageBar}>
        <View
          style={[
            styles.viewToggle,
            { borderColor: props.theme.colors.border },
          ]}
        >
          {(["columns", "packages"] as const).map((mode) => (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityState={{ selected: viewMode === mode }}
              onPress={() => setViewMode(mode)}
              style={[
                styles.viewToggleButton,
                viewMode === mode && {
                  backgroundColor: props.theme.colors.accent,
                },
              ]}
            >
              <Text
                style={{
                  color:
                    viewMode === mode
                      ? props.theme.colors.accentForeground
                      : props.theme.colors.foreground,
                }}
              >
                {mode === "columns"
                  ? t.packages.columnsView
                  : t.packages.packagesView}
              </Text>
            </Pressable>
          ))}
        </View>
        {selection.ids.size > 0 && (
          <View
            style={[
              styles.selectionBar,
              {
                borderColor: props.theme.colors.accent,
                backgroundColor: props.theme.colors.surface1,
              },
            ]}
          >
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: props.theme.colors.foreground, flex: 1 }}
            >
              {t.packages.selected.replace(
                "{count}",
                String(selection.ids.size),
              )}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.packages.addToPackage}
              onPress={() =>
                setPackageMenu({
                  taskIds: selectedCards.map((card) => card.id),
                })
              }
              style={[
                styles.toolbarButton,
                { backgroundColor: props.theme.colors.accent },
              ]}
            >
              <Icon
                name="PackagePlus"
                size={15}
                color={props.theme.colors.accentForeground}
              />
              <Text style={{ color: props.theme.colors.accentForeground }}>
                {t.packages.addToPackage}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.packages.clear}
              onPress={() => setSelection(clearSelection())}
              style={styles.toolbarButton}
            >
              <Icon
                name="X"
                size={15}
                color={props.theme.colors.foregroundMuted}
              />
              <Text style={{ color: props.theme.colors.foreground }}>
                {t.packages.clear}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
      {packageUndo && (
        <View
          style={[
            styles.packageUndo,
            { borderColor: props.theme.colors.border },
          ]}
        >
          <Text style={{ color: props.theme.colors.foreground, flex: 1 }}>
            {t.packages.added
              .replace("{count}", String(packageUndo.previous.length))
              .replace("{name}", packageUndo.name)}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void undoPackage()}
            style={styles.toolbarButton}
          >
            <Icon name="Undo2" size={15} color={props.theme.colors.accent} />
            <Text style={{ color: props.theme.colors.accent }}>
              {t.packages.undo}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setPackageAdjustId(packageUndo.packageId)}
            style={styles.toolbarButton}
          >
            <Text style={{ color: props.theme.colors.foreground }}>
              {t.packages.adjust}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.closeMenu}
            onPress={() => setPackageUndo(null)}
            style={styles.toolbarButton}
          >
            <Icon
              name="X"
              size={15}
              color={props.theme.colors.foregroundMuted}
            />
          </Pressable>
        </View>
      )}
      {filtersOpen && (
        <FilterPanel
          filters={filters}
          onChange={updateFilters}
          packages={board.packages}
          t={t}
        />
      )}
      {(hasActiveFilter || filtersOpen) && (
        <View style={styles.filterSummary}>
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.cardMeta,
              { color: props.theme.colors.foregroundMuted, flex: 1 },
            ]}
          >
            {t.filterSummary
              .replace("{count}", String(cards.length - conflicts.length))
              .replace(
                "{total}",
                String(
                  allCards.filter((card) => card.stage !== "conflict").length,
                ),
              )
              .replace("{filters}", String(filterCount))}
            {` · ${t.conflictCount.replace("{count}", String(conflicts.length))}`}
          </Text>
          {hasActiveFilter && (
            <Pressable
              accessibilityRole="button"
              onPress={clearFilters}
              style={styles.toolbarButton}
            >
              <Icon
                name="X"
                size={14}
                color={props.theme.colors.foregroundMuted}
              />
              <Text
                style={[
                  styles.cardMeta,
                  { color: props.theme.colors.foreground },
                ]}
              >
                {t.clearFilters}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {(!board.connected || boardQuery.isError) && (
        <View style={styles.filterSummary}>
          <Text
            style={[styles.notice, { color: props.theme.colors.statusWarning }]}
          >
            {t.disconnected}
          </Text>
          <Pressable
            testID="workboard-reconnect"
            accessibilityRole="button"
            accessibilityLabel={t.refresh}
            onPress={() => void boardQuery.refetch()}
            style={styles.toolbarButton}
          >
            <Text style={{ color: props.theme.colors.foreground }}>
              {t.refresh}
            </Text>
          </Pressable>
        </View>
      )}
      {board.error && (
        <Text
          style={[styles.notice, { color: props.theme.colors.statusDanger }]}
        >
          {bootErrorText(board.error, t)}
        </Text>
      )}
      <FactoryLine
        summary={board.factory}
        t={t.factory}
        theme={props.theme}
        inset
      />
      {conflicts.length > 0 && (
        <ConflictNotice
          cards={conflicts}
          disabled={writesDisabled}
          t={t}
          theme={props.theme}
          onSelect={setStatusCard}
        />
      )}
      <View style={styles.boardRow}>
        <View style={styles.boardArea}>
          {viewMode === "columns" ? (
            <BoardView
              key={props.host.id}
              hostId={props.host.id}
              groupColor={(group) => groupColor(group, props.theme)}
              disabled={writesDisabled}
              pendingStages={new Set(optimisticStages.keys())}
              reordering={pendingMutationIds.has("reorder-groups")}
              highlightedCards={new Set(moveUndos.keys())}
              cards={cards}
              fullCards={board.cards}
              cardOrderByStage={board.cardOrderByStage}
              filterKey={JSON.stringify(filters)}
              archivedByStage={archivedByColumn(
                archivedCards,
                board.settings.groups,
              )}
              renderArchivedCard={(card) => (
                <ArchivedBoardCard
                  card={card}
                  t={t}
                  theme={props.theme}
                  disabled={writesDisabled}
                  onOpen={() => setPanel(openPanel(card.id, "ticket", null))}
                  onRestore={() => setRestoringArchived(card)}
                />
              )}
              orderPending={
                new Set(
                  [...pendingMutationIds]
                    .filter((id) => id.startsWith("card-order:"))
                    .map((id) => id.slice("card-order:".length)),
                )
              }
              onReorderCards={(card, expectedOrder, cardOrder) =>
                saveCardOrder({
                  action: "reorder-cards",
                  taskId: card.id,
                  stage: card.stage as Stage,
                  expectedOrder,
                  cardOrder,
                })
              }
              onResetCardOrder={(stage, expectedOrder) =>
                saveCardOrder({
                  action: "reset-card-order",
                  stage,
                  expectedOrder,
                })
              }
              hasActiveFilter={hasActiveFilter}
              onClearFilters={clearFilters}
              onCreateTask={writesDisabled ? undefined : createTask}
              renderQuickCreate={(group) =>
                group.kind === "todo" ? (
                  <QuickCreate
                    key={group.id}
                    disabled={writesDisabled}
                    t={t}
                    theme={props.theme}
                    groupName={groupTitle(group, t)}
                    onCreate={async (title) => {
                      const next = await mutate(
                        {
                          action: "create",
                          stage: group.id,
                          title,
                          description: "",
                          projectId:
                            projectId === "all" || projectId === "none"
                              ? null
                              : projectId,
                        },
                        `create:${group.id}`,
                      );
                      if (!next) return false;
                      notifyTaskSaved(next, undefined, true);
                      return true;
                    }}
                  />
                ) : null
              }
              groups={orderedGroups({
                ...board.settings,
                groupOrder: optimisticOrder ?? board.settings.groupOrder,
              })}
              compact={props.layout.compact}
              stage={
                board.settings.groups.find(
                  (group) => group.id === selectedStage,
                )?.id ??
                defaultWorkspaceGroup(
                  board.settings.groups,
                  board.settings.defaultStartGroup,
                )
              }
              setStage={setSelectedStage}
              t={t}
              theme={props.theme}
              onStage={setStage}
              onReorder={async (groupOrder, expectedGroupOrder) => {
                if (mutationPending.current.has("reorder-groups")) {
                  toast.error(t.mutationPending);
                  return false;
                }
                setOptimisticOrder(groupOrder);
                const next = await mutate({
                  action: "reorder-groups",
                  groupOrder,
                  expectedGroupOrder,
                });
                setOptimisticOrder(null);
                if (next)
                  toast.show(t.layoutSaved, {
                    variant: "success",
                    durationMs: 1600,
                  });
                return !!next;
              }}
              onEdit={editGroup}
              onAdd={() => editGroup(newGroup(board.settings.groups))}
              deleteReason={deleteReason}
              onDelete={async (group) => {
                const reason = deleteReason(group);
                if (reason) {
                  toast.show(reason, { variant: "warning" });
                  return false;
                }
                return !!(await mutate({
                  action: "settings",
                  revision: board.revision,
                  expectedSettings: board.settings,
                  settings: {
                    ...board.settings,
                    groups: board.settings.groups.filter(
                      (item) => item.id !== group.id,
                    ),
                  },
                }));
              }}
              renderCard={renderTaskCard}
              onMarqueeSelect={(ids, additive) =>
                setSelection((current) =>
                  marqueeSelection(current, ids, additive),
                )
              }
            />
          ) : (
            <PackagesView
              board={board}
              cards={cards}
              packages={board.packages}
              groups={orderedGroups(board.settings)}
              t={t}
              theme={props.theme}
              onOpenPackage={(pkg) => setPackageDetailId(pkg.id)}
              onOpenCard={(card) =>
                setPanel(openPanel(card.id, "ticket", null))
              }
              onLongPressCard={(card) =>
                setSelection(longPressCard(selection, card.id))
              }
              onAssignCard={(packageId, cardId) =>
                void dropCardOnPackage(packageId, cardId)
              }
              renderCard={(card) => renderTaskCard(card, null)}
            />
          )}
        </View>
        {panelCard && (
          <TaskPanel
            card={panelCard}
            board={board}
            icons={projectIcons}
            t={t}
            theme={props.theme}
            compact={props.layout.compact}
            onClose={() => setPanel(null)}
            view={panel?.view ?? "ticket"}
            viewAgentId={panel?.agentId ?? null}
            onShowTicket={() =>
              setPanel((p) => p && openPanel(p.taskId, "ticket", null))
            }
            onShowAgent={(id) =>
              setPanel((p) => p && openPanel(p.taskId, "agent", id))
            }
            width={clampPanelWidth(panelWidth, rootSize.width)}
            containerWidth={rootSize.width}
            onResize={setPanelWidth}
            onResizeEnd={(width) => {
              setPanelWidth(width);
              savePanelWidth(props.host.id, width);
            }}
            hostId={props.host.id}
            navigation={props.navigation}
            onOpenWorkspace={
              panelCard.workspaceId && props.navigation
                ? () =>
                    props.navigation?.openWorkspace({
                      workspaceId: panelCard.workspaceId as string,
                      serverId: board.serverId,
                    })
                : undefined
            }
            onOpenAgent={(id) => openAgent(id, panelCard)}
            onEdit={() => void editTask(panelCard)}
            onStatus={
              panelCard.binding || panelCard.archived
                ? undefined
                : () => setStatusCard(panelCard)
            }
          />
        )}
      </View>
      {cardMenu && (
        <CardContextMenu
          menu={cardMenu}
          viewport={menuViewport}
          t={t}
          theme={props.theme}
          onClose={() => setCardMenu(null)}
        />
      )}
      {packageMenu && (
        <PackageMenu
          packages={board.packages.filter(
            (pkg) => pkg.projectId === packageMenuProjectId,
          )}
          taskIds={packageMenu.taskIds}
          hasPackage={packageMenu.taskIds.some(
            (id) =>
              board.cards.find((card) => card.id === id)?.packageId != null,
          )}
          t={t}
          theme={props.theme}
          onClose={() => setPackageMenu(null)}
          onAssign={(packageId) => void assignPackage(packageId)}
          onCreate={(name) => void createPackage(name)}
          onRemove={() => void removeFromPackage(packageMenu.taskIds)}
          onAskPm={() => void askPmToGroup(packageMenu.taskIds)}
        />
      )}
      {packageDetail && (
        <PackageDetail
          pkg={packageDetail}
          board={board}
          runs={packageRunsQuery.data?.runs ?? []}
          t={t}
          theme={props.theme}
          onClose={() => setPackageDetailId(null)}
          onRunGate={() => void runPackageGate(packageDetail.id)}
          onAdjust={() => {
            setPackageAdjustId(packageDetail.id);
            setPackageDetailId(null);
          }}
          onClosePackage={() => void closePackage(packageDetail.id)}
          onProposeClose={() => void proposePackageClose(packageDetail)}
        />
      )}
      {packageAdjust && (
        <PackageAdjust
          pkg={packageAdjust}
          t={t}
          theme={props.theme}
          onClose={() => setPackageAdjustId(null)}
          onSave={(patch) =>
            void updatePackage(packageAdjust.id, {
              name: patch.name,
              night: patch.night,
              onClose: patch.onClose,
              branch: patch.branch,
            })
          }
        />
      )}
      {editingGroup && (
        <GroupEditor
          key={editingGroup.group.id}
          board={board}
          group={editingGroup.group}
          groups={editingGroup.settings.groups}
          disabled={writesDisabled || groupsPending}
          saving={groupsPending}
          t={t}
          theme={props.theme}
          onClose={() => setEditingGroup(null)}
          onChange={async (groups) =>
            !!(await mutate(
              {
                action: "settings",
                revision: editingGroup.revision,
                expectedSettings: editingGroup.settings,
                settings: { ...editingGroup.settings, groups },
              },
              "settings:groups",
            ))
          }
        />
      )}
      <TaskModal
        disabled={writesDisabled || draftPending}
        pending={draftPending}
        form={draft}
        board={board}
        icons={projectIcons}
        t={t}
        theme={props.theme}
        onClose={() => setDraft(null)}
        onSave={(form) =>
          void (
            form.task
              ? mutate({
                  action: "edit",
                  taskId: form.task.id,
                  updatedAt: form.task.updatedAt,
                  title: form.title,
                  description: form.description,
                  projectId: form.projectId,
                  orchestratorId: form.orchestratorId ?? null,
                  ...(form.task.workspaceId === null
                    ? { timing: form.timing ?? null }
                    : {}),
                })
              : mutate({
                  action: "create",
                  title: form.title,
                  description: form.description,
                  orchestratorId: form.orchestratorId ?? null,
                  projectId: form.projectId,
                  ...(form.timing ? { timing: form.timing } : {}),
                  ...(form.stage && !form.timing ? { stage: form.stage } : {}),
                })
          ).then((next) => {
            if (!next) return;
            notifyTaskSaved(next, form.task?.id);
            setDraft(null);
          })
        }
      />
      <StartModal
        disabled={writesDisabled || startPending}
        pending={startPending}
        stage={starting?.stage}
        card={starting?.card ?? null}
        board={board}
        icons={projectIcons}
        t={t}
        theme={props.theme}
        onClose={() => setStarting(null)}
        onStart={(target, stage) =>
          void mutate({
            action: "start",
            taskId: starting!.card.id,
            target,
            stage,
          }).then((next) => {
            if (!next) return;
            const workspaceId =
              target.kind === "existing"
                ? target.workspaceId
                : next.cards.find((card) => card.id === starting!.card.id)
                    ?.workspaceId;
            if (workspaceId)
              props.navigation?.openWorkspace({
                workspaceId,
                serverId: next.serverId,
              });
            setStarting(null);
          })
        }
      />
      {restoringArchived && (
        <ConfirmationModal
          title={t.restoreTask}
          description={t.restoreTaskConfirm.replace(
            "{name}",
            restoringArchived.title,
          )}
          confirmLabel={t.restoreTask}
          disabled={writesDisabled}
          t={t}
          theme={props.theme}
          onClose={() => setRestoringArchived(null)}
          onConfirm={async () =>
            !!(await mutate({
              action: "resolve-archive",
              taskId: restoringArchived.id,
              updatedAt: restoringArchived.updatedAt,
              operationId: restoringArchived.archived!.operationId,
              outcome: "restore",
            }))
          }
        />
      )}
      {/* CUSTOM(delete-task) */}
      {deletingTask && (
        <ConfirmationModal
          title={t.deleteTask}
          description={t.deleteTaskConfirm.replace(
            "{name}",
            [taskNumberLabel(deletingTask.number), `“${deletingTask.title}”`]
              .filter(Boolean)
              .join(" "),
          )}
          confirmLabel={t.deleteTask}
          disabled={writesDisabled}
          t={t}
          theme={props.theme}
          onClose={() => setDeletingTask(null)}
          onConfirm={async () =>
            !!(await mutate({
              action: "delete-task",
              taskId: deletingTask.id,
            }))
          }
        />
      )}
      {archivingDraft && (
        <ConfirmationModal
          title={t.archiveDraft}
          description={t.archiveDraftConfirm.replace(
            "{name}",
            archivingDraft.title,
          )}
          confirmLabel={t.archiveDraft}
          disabled={writesDisabled}
          t={t}
          theme={props.theme}
          onClose={() => setArchivingDraft(null)}
          onConfirm={async () =>
            !!(await mutate({
              action: "archive-draft",
              taskId: archivingDraft.id,
            }))
          }
        />
      )}
      {detachingDraft && (
        <ConfirmationModal
          title={t.detachDraft}
          description={t.detachDraftConfirm.replace(
            "{name}",
            detachingDraft.card.mergedDrafts.find(
              (source) => source.draftId === detachingDraft.draftId,
            )!.title,
          )}
          confirmLabel={t.detachDraft}
          disabled={writesDisabled}
          t={t}
          theme={props.theme}
          onClose={() => setDetachingDraft(null)}
          onConfirm={async () =>
            !!(await mutate({
              action: "detach-draft",
              taskId: detachingDraft.card.id,
              draftId: detachingDraft.draftId,
              updatedAt: detachingDraft.card.updatedAt,
            }))
          }
        />
      )}
      {cancelingBinding?.binding && (
        <ConfirmationModal
          title={t.cancelBinding}
          description={t.cancelBindingConfirm.replace(
            "{name}",
            cancelingBinding.title,
          )}
          confirmLabel={t.cancelBinding}
          disabled={writesDisabled}
          t={t}
          theme={props.theme}
          onClose={() => setCancelingBinding(null)}
          onConfirm={async () =>
            !!(await mutate({
              action: "cancel-binding",
              taskId: cancelingBinding.id,
              operationId: cancelingBinding.binding!.operationId,
            }))
          }
        />
      )}
      <StageModal
        disabled={
          writesDisabled ||
          (!!statusCard && pendingMutationIds.has(`stage:${statusCard.id}`))
        }
        groups={orderedGroups(board.settings)}
        card={statusCard}
        t={t}
        theme={props.theme}
        onClose={() => setStatusCard(null)}
        onStage={setStage}
      />
    </View>
  );
}

function ConflictNotice({
  cards,
  disabled,
  t,
  theme,
  onSelect,
}: {
  cards: Card[];
  disabled: boolean;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onSelect(card: Card): void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View
      style={[
        styles.conflict,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [
          styles.conflictRow,
          pressed && { backgroundColor: theme.colors.surface2 },
        ]}
      >
        <Icon
          name="TriangleAlert"
          size={16}
          color={theme.colors.statusWarning}
        />
        <Text
          style={[styles.conflictTitle, { color: theme.colors.foreground }]}
        >
          {t.conflictSummary.replace("{count}", String(cards.length))}
        </Text>
        <Icon
          name={expanded ? "ChevronUp" : "ChevronDown"}
          size={16}
          color={theme.colors.foregroundMuted}
        />
      </Pressable>
      {expanded && (
        <>
          <Text
            style={[
              styles.conflictHint,
              { color: theme.colors.foregroundMuted },
            ]}
          >
            {t.conflictHint}
          </Text>
          <ScrollView style={styles.conflictList}>
            {cards.map((card) => (
              <Pressable
                key={card.id}
                accessibilityRole="button"
                accessibilityLabel={`${card.title} · ${t.resolveConflict}`}
                disabled={disabled}
                onPress={() => onSelect(card)}
                style={({ pressed }) => [
                  styles.conflictRow,
                  { opacity: disabled ? 0.5 : 1 },
                  pressed && { backgroundColor: theme.colors.surface2 },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.conflictTitle,
                    { color: theme.colors.foreground },
                  ]}
                >
                  {card.title}
                </Text>
                <Text
                  style={[
                    styles.cardMeta,
                    { color: theme.colors.foregroundMuted },
                  ]}
                >
                  {t.resolveConflict}
                </Text>
                <Icon
                  name="ArrowRightLeft"
                  size={15}
                  color={theme.colors.foregroundMuted}
                />
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}
function Centered({
  theme,
  text,
  action,
  onPress,
}: {
  theme: PluginSurfaceProps["theme"];
  text: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={[styles.centered, { backgroundColor: theme.colors.surface0 }]}>
      <Text style={{ color: theme.colors.foregroundMuted }}>{text}</Text>
      {action && (
        <Pressable accessibilityRole="button" onPress={onPress}>
          <Text style={[styles.primary, { color: theme.colors.foreground }]}>
            {action}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
function ProjectPicker({
  board,
  icons,
  value,
  setValue,
  t,
  theme,
  compact,
}: {
  board: Board;
  icons: ProjectIcons;
  value: string;
  setValue(value: string): void;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = [
    { id: "all", name: t.allProjects },
    { id: "none", name: t.unassigned },
    ...board.projects,
  ];
  const selectedProject = board.projects.find((item) => item.id === value);
  return (
    <View
      style={[styles.projectPicker, compact && styles.projectPickerCompact]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t.selectProject}: ${options.find((item) => item.id === value)?.name}`}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [
          styles.toolbarButton,
          styles.projectTrigger,
          {
            borderColor: theme.colors.border,
            backgroundColor: pressed
              ? theme.colors.surface2
              : theme.colors.surface1,
          },
        ]}
      >
        {selectedProject ? (
          <ProjectIcon
            name={selectedProject.name}
            color={projectAccentColor(
              selectedProject.accent,
              selectedProject.id,
              theme,
            )}
            fillColor={projectLetterFill(
              selectedProject.letterFill,
              selectedProject.accent,
              selectedProject.id,
            )}
            size={14}
            icon={projectIconFor(icons, selectedProject.id)}
          />
        ) : null}
        <Text
          numberOfLines={1}
          style={[
            styles.controlText,
            styles.projectName,
            { color: theme.colors.foreground },
          ]}
        >
          {options.find((item) => item.id === value)?.name}
        </Text>
        <View style={styles.fixedIcon}>
          <Icon
            name="ChevronDown"
            size={14}
            color={theme.colors.foregroundMuted}
          />
        </View>
      </Pressable>
      {open && (
        <Modal open title={t.selectProject} onOpenChange={setOpen}>
          <Modal.Content>
            <ScrollView style={styles.choiceList}>
              {options.map((option) => {
                const project = board.projects.find(
                  (item) => item.id === option.id,
                );
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={option.id}
                    {...toggleButtonState(option.id === value)}
                    style={({ pressed }) => [
                      styles.menuItem,
                      {
                        backgroundColor:
                          option.id === value
                            ? theme.colors.accent
                            : pressed
                              ? theme.colors.surface2
                              : "transparent",
                      },
                    ]}
                    onPress={() => {
                      setValue(option.id);
                      setOpen(false);
                    }}
                  >
                    <View style={styles.projectChoiceRow}>
                      {project ? (
                        <ProjectIcon
                          name={project.name}
                          color={projectAccentColor(
                            project.accent,
                            project.id,
                            theme,
                          )}
                          fillColor={projectLetterFill(
                            project.letterFill,
                            project.accent,
                            project.id,
                          )}
                          size={14}
                          icon={projectIconFor(icons, project.id)}
                        />
                      ) : null}
                      <Text
                        style={{
                          color:
                            option.id === value
                              ? theme.colors.accentForeground
                              : theme.colors.foreground,
                        }}
                      >
                        {option.name}
                      </Text>
                      {option.id === value && (
                        <Icon
                          name="Check"
                          size={16}
                          color={theme.colors.accentForeground}
                        />
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Modal.Content>
        </Modal>
      )}
    </View>
  );
}
/** What the orchestrator is doing with this card, if it touched it. */
function OrchestrationLine({
  card,
  board,
  t,
  theme,
  onOpenAgent,
  onOpenAgentInPanel,
}: {
  card: Card;
  board: Board;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onOpenAgent(agentId: string): void;
  onOpenAgentInPanel?(agentId: string): void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false); // CUSTOM(task-checkpoints)
  const record = board.orchestrations[card.id];
  const refinement = board.refinements[card.id];
  if (!record && refinement && card.workspaceId === null) {
    const color =
      refinement.status === "failed"
        ? theme.colors.statusWarning
        : refinement.status === "written"
          ? theme.colors.foregroundMuted
          : theme.colors.accent;
    return (
      <View style={styles.cardFooter}>
        <Icon name="MessagesSquare" size={13} color={color} />
        <Text style={[styles.cardMeta, { color }]} numberOfLines={2}>
          {t.refinementStatus[refinement.status]}
          {refinement.error ? ` · ${refinement.error}` : ""}
        </Text>
      </View>
    );
  }
  if (!record) return null;
  const color =
    record.status === "failed"
      ? theme.colors.statusWarning
      : record.status === "finished"
        ? theme.colors.foregroundMuted
        : theme.colors.accent;
  const owner =
    board.orchestrators.find((o) => o.id === record.orchestratorId)?.name ??
    t.orchestrator;
  // CUSTOM(task-checkpoints): a long task shows its progress, or why it waits.
  const progress = board.progress[card.id];
  const now = new Date();
  let badge: string | null = null;
  if (progress) {
    if (record.status === "waiting" && record.checkpoint) {
      badge = waitingLine(
        record,
        { until: t.checkpoint.until, nextPass: t.checkpoint.nextPass },
        now,
      );
    } else if (record.status === "queued" && record.checkpoint) {
      badge = t.checkpoint.nextPass;
    } else if (record.status === "running" || record.status === "starting") {
      badge =
        progressBadge(
          {
            done: progress.done.length,
            total: progress.done.length + progress.next.length,
            checkpoints: progress.checkpoints,
          },
          t.checkpoint.word,
        ) || null;
    }
  }
  // CUSTOM(usage-limit): paused by the usage limit, with the time it resumes.
  const limited = record.limited && record.status === "waiting";
  const statusText = limited
    ? limitLine(record.resumeAt, t.limit, now)
    : `${t.orchestrationStatus[record.status]}${badge ? ` · ${badge}` : ""}`;
  const text = `${owner}: ${statusText}${record.error ? ` · ${record.error}` : ""}`;
  // CUSTOM(card-open-agent): the same agent the card links everywhere else.
  const agentId = cardAgentId(card, record);
  return (
    <>
      <View style={styles.cardFooter}>
        <Icon name="Bot" size={13} color={color} />
        <Text style={[styles.cardMeta, { color, flex: 1 }]} numberOfLines={2}>
          {text}
        </Text>
        {progress && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.checkpoint.details}
            accessibilityState={{ expanded: detailsOpen }}
            onPress={() => setDetailsOpen((value) => !value)}
            style={styles.iconAction}
          >
            <Icon
              name={detailsOpen ? "ChevronDown" : "ChevronRight"}
              size={14}
              color={theme.colors.accent}
            />
          </Pressable>
        )}
        {agentId && (
          <OpenAgentLink
            t={t}
            theme={theme}
            onPress={() => onOpenAgent(agentId)}
            onMiddleClick={
              onOpenAgentInPanel ? () => onOpenAgentInPanel(agentId) : undefined
            }
          />
        )}
      </View>
      {progress && detailsOpen && (
        <View
          style={[
            styles.review,
            {
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface1,
            },
          ]}
        >
          {progress.done.length + progress.next.length === 0 && (
            <Text
              style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
            >
              {t.checkpoint.noItems}
            </Text>
          )}
          {progress.done.map((item, index) => (
            <View key={`done-${index}`} style={styles.cardFooter}>
              <Icon name="Check" size={13} color={theme.colors.statusSuccess} />
              <Text
                selectable
                style={[
                  styles.cardMeta,
                  { color: theme.colors.foreground, flex: 1 },
                ]}
              >
                {item}
              </Text>
            </View>
          ))}
          {progress.next.map((item, index) => (
            <View key={`next-${index}`} style={styles.cardFooter}>
              <Icon
                name="Circle"
                size={13}
                color={theme.colors.foregroundMuted}
              />
              <Text
                selectable
                style={[
                  styles.cardMeta,
                  { color: theme.colors.foreground, flex: 1 },
                ]}
              >
                {item}
              </Text>
            </View>
          ))}
          {progress.log.length > 0 && (
            <Text
              style={[styles.reviewTitle, { color: theme.colors.foreground }]}
            >
              {t.checkpoint.log}
            </Text>
          )}
          {logLines(progress.log, now).map((line) => (
            <Text
              key={line.key}
              selectable
              style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
            >
              {line.time} ·{" "}
              {t.checkpoint.entry
                .replace("{n}", String(line.checkpoint))
                .replace("{text}", line.text)}
            </Text>
          ))}
        </View>
      )}
    </>
  );
}

/**
 * A Ready to review card asks the reviewer, like an agent's question: the agent's last reply,
 * then Done or Continue task with optional feedback.
 */
function ReviewPrompt({
  card,
  board,
  t,
  theme,
  disabled,
  onReview,
}: {
  card: Card;
  board: Board;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  disabled: boolean;
  onReview(outcome: "done" | "continue", feedback: string): Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [writing, setWriting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [sending, setSending] = useState(false);
  const summary = board.orchestrations[card.id]?.summary ?? null;
  const ask = board.orchestrations[card.id]?.ask ?? null;
  const send = async (outcome: "done" | "continue") => {
    setSending(true);
    try {
      if (await onReview(outcome, outcome === "continue" ? feedback : "")) {
        setWriting(false);
        setFeedback("");
      }
    } finally {
      setSending(false);
    }
  };
  const busy = disabled || sending;
  const button = (
    label: string,
    hint: string,
    icon: string,
    onPress: () => void,
    primary = false,
    blocked = busy,
  ) => (
    <CardAction
      theme={theme}
      hint={hint}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={blocked}
      onPress={onPress}
      style={[
        styles.reviewButton,
        {
          borderColor: primary ? theme.colors.accent : theme.colors.border,
          backgroundColor: primary
            ? theme.colors.accent
            : theme.colors.surface1,
          opacity: blocked ? 0.5 : 1,
        },
      ]}
    >
      <Icon
        name={icon}
        size={14}
        color={
          primary ? theme.colors.accentForeground : theme.colors.foreground
        }
      />
      <Text
        style={[
          styles.cardMeta,
          {
            color: primary
              ? theme.colors.accentForeground
              : theme.colors.foreground,
          },
        ]}
      >
        {label}
      </Text>
    </CardAction>
  );
  return (
    <View
      testID={`workboard-review-${card.id}`}
      style={[
        styles.review,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        },
      ]}
    >
      <View style={styles.cardFooter}>
        <Icon name="ClipboardCheck" size={14} color={theme.colors.accent} />
        <Text style={[styles.reviewTitle, { color: theme.colors.foreground }]}>
          {t.review.title}
        </Text>
      </View>
      <Text
        selectable
        numberOfLines={expanded ? undefined : 6}
        style={[
          styles.cardMeta,
          {
            color: summary
              ? theme.colors.foreground
              : theme.colors.foregroundMuted,
          },
        ]}
      >
        {summary ?? t.review.noSummary}
      </Text>
      {summary && summary.length > 280 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded((value) => !value)}
        >
          <Text style={[styles.cardMeta, { color: theme.colors.accent }]}>
            {expanded ? t.review.less : t.review.more}
          </Text>
        </Pressable>
      )}
      {ask && ask.options.length > 0 && !writing ? (
        <View style={{ gap: 6 }}>
          <Text
            style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
          >
            {t.review.options}
          </Text>
          {ask.options.map((option) => {
            const recommended = ask.recommend === option.id;
            return (
              <CardAction
                key={option.id}
                theme={theme}
                hint={option.label}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                disabled={busy}
                onPress={() =>
                  void onReview("continue", optionAnswer(ask.question, option))
                }
                style={{
                  borderWidth: 1,
                  borderRadius: 6,
                  padding: 8,
                  gap: 2,
                  borderColor: recommended
                    ? theme.colors.accent
                    : theme.colors.border,
                  backgroundColor: theme.colors.surface0,
                  opacity: busy ? 0.5 : 1,
                }}
              >
                <Text
                  style={[
                    styles.cardMeta,
                    { color: theme.colors.foreground, fontWeight: "600" },
                  ]}
                >
                  {option.label}
                  {recommended ? ` · ${t.review.recommended}` : ""}
                </Text>
                {option.gains || option.costs ? (
                  <Text
                    style={[
                      styles.cardMeta,
                      { color: theme.colors.foregroundMuted },
                    ]}
                  >
                    {[
                      option.gains ? `+ ${option.gains}` : null,
                      option.costs ? `− ${option.costs}` : null,
                    ]
                      .filter(Boolean)
                      .join("  ")}
                  </Text>
                ) : null}
              </CardAction>
            );
          })}
          {ask.why ? (
            <Text
              style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
            >
              {t.review.why}: {ask.why}
            </Text>
          ) : null}
        </View>
      ) : null}
      {writing ? (
        <>
          <TextInput
            autoFocus
            multiline
            editable={!busy}
            accessibilityLabel={t.review.feedback}
            placeholder={t.review.feedback}
            placeholderTextColor={theme.colors.foregroundMuted}
            value={feedback}
            onChangeText={setFeedback}
            style={[
              styles.input,
              styles.reviewInput,
              {
                color: theme.colors.foreground,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface0,
              },
            ]}
          />
          <View style={styles.reviewActions}>
            {button(t.review.cancel, t.review.cancel, "X", () => {
              setWriting(false);
              setFeedback("");
            })}
            {button(
              t.review.send,
              t.review.continueHint,
              "Undo2",
              () => void send("continue"),
              true,
            )}
          </View>
        </>
      ) : (
        <View style={styles.reviewActions}>
          {button(
            t.review.continue,
            t.review.continueHint,
            "MessageSquareReply",
            () => setWriting(true),
          )}
          {button(
            t.review.done,
            t.review.doneHint,
            "Check",
            () => void send("done"),
            true,
          )}
        </View>
      )}
    </View>
  );
}

const FINISH_ICONS: Record<FinishStep, string> = {
  commit: "GitCommitHorizontal",
  pr: "FileText",
  merge: "GitMerge",
};

/** CUSTOM(card-open-agent): the card's Open agent link. */
function OpenAgentLink({
  t,
  theme,
  onPress,
  onMiddleClick,
}: {
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onPress(): void;
  /** CUSTOM(task-panel): middle click opens the panel in Agent view instead of the card's Ticket. */
  onMiddleClick?(): void;
}) {
  const middleRef = useMiddleClick(onMiddleClick);
  const link = (
    <HintButton
      hint={t.openAgentHint}
      accessibilityRole="link"
      accessibilityLabel={t.openAgent}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconAction,
        pressed && { backgroundColor: theme.colors.surface2 },
      ]}
    >
      <Text
        style={[
          styles.cardMeta,
          { color: theme.colors.accent, textDecorationLine: "underline" },
        ]}
      >
        {t.openAgent}
      </Text>
    </HintButton>
  );
  return onMiddleClick ? <View ref={middleRef}>{link}</View> : link;
}

/**
 * A Done task's work is still in its worktree: Commit it, get a PR description from its agent, or
 * merge it into the project. Each is the user's call; the task is already Done. Once merged, only
 * PR description is left (see `finishButtons`).
 */
function FinishActions({
  card,
  board,
  t,
  theme,
  disabled,
  onFinish,
}: {
  card: Card;
  board: Board;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  disabled: boolean;
  onFinish(step: FinishStep): void;
}) {
  const toast = useToast();
  const isGit = board.projects.find((p) => p.id === card.projectId)?.isGit;
  if (!isGit) return null;
  const finish = board.finishes[card.id];
  const running = finish?.running ?? null;
  const busy = disabled || running !== null;
  const status = running
    ? t.finish.running[running]
    : (finish?.error ??
      (finish?.mergedAt
        ? `${t.finish.merged} · ${shortDate(finish.mergedAt, t.locale)}`
        : finish?.committedAt
          ? t.finish.committed
          : null));
  const { steps, primary } = finishButtons(finish, card.inPlace); // CUSTOM(orchestrator-in-place)
  const pr =
    finish?.prBody !== null && finish?.prBody !== undefined
      ? `${finish.prTitle ? `# ${finish.prTitle}\n\n` : ""}${finish.prBody}`
      : null;
  const button = (step: FinishStep, icon: string, primary = false) => (
    <CardAction
      key={step}
      theme={theme}
      hint={t.finish.hints[step]}
      accessibilityRole="button"
      accessibilityLabel={t.finish.labels[step]}
      testID={`workboard-finish-${step}-${card.id}`}
      disabled={busy}
      onPress={() => onFinish(step)}
      style={[
        styles.reviewButton,
        {
          borderColor: primary ? theme.colors.accent : theme.colors.border,
          backgroundColor: primary
            ? theme.colors.accent
            : theme.colors.surface1,
          opacity: busy ? 0.5 : 1,
        },
      ]}
    >
      <Icon
        name={running === step ? "LoaderCircle" : icon}
        size={14}
        color={
          primary ? theme.colors.accentForeground : theme.colors.foreground
        }
      />
      <Text
        style={[
          styles.cardMeta,
          {
            color: primary
              ? theme.colors.accentForeground
              : theme.colors.foreground,
          },
        ]}
      >
        {t.finish.labels[step]}
      </Text>
    </CardAction>
  );
  const statusRow = status ? (
    <View style={styles.cardFooter}>
      <Icon
        name={
          finish?.error && !running
            ? "TriangleAlert"
            : running
              ? "LoaderCircle"
              : "GitMerge"
        }
        size={13}
        color={
          finish?.error && !running
            ? theme.colors.statusWarning
            : theme.colors.foregroundMuted
        }
      />
      <Text
        style={[
          styles.cardMeta,
          {
            color:
              finish?.error && !running
                ? theme.colors.statusWarning
                : theme.colors.foregroundMuted,
            flexShrink: 1,
          },
        ]}
      >
        {status}
      </Text>
    </View>
  ) : null;
  const actions = steps.map((step) =>
    button(step, FINISH_ICONS[step], step === primary),
  );
  // CUSTOM(workboard-finish-inline): one button and no PR body have nothing to fill a second
  // row, so the status and the button share a line instead of stacking.
  const inline = finishInlineLayout({
    hasStatus: statusRow !== null,
    hasPr: pr !== null,
    steps: steps.length,
  });
  return (
    <View
      testID={`workboard-finish-${card.id}`}
      style={[
        styles.review,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        },
      ]}
    >
      {inline ? (
        <View style={styles.finishInline}>
          {statusRow}
          {actions}
        </View>
      ) : (
        <>
          {statusRow}
          {pr && (
            <View style={styles.prBox}>
              <Text
                selectable
                numberOfLines={8}
                style={[styles.cardMeta, { color: theme.colors.foreground }]}
              >
                {pr}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void copyText(pr).then(
                    () => toast.show(t.finish.copied),
                    () => toast.error(t.finish.copyFailed),
                  )
                }
              >
                <Text style={[styles.cardMeta, { color: theme.colors.accent }]}>
                  {t.finish.copy}
                </Text>
              </Pressable>
            </View>
          )}
          <View style={styles.reviewActions}>{actions}</View>
        </>
      )}
    </View>
  );
}

function CardAction({
  theme,
  style,
  ...props
}: ComponentProps<typeof HintButton> & { theme: PluginSurfaceProps["theme"] }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <HintButton
      {...props}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={(state) => [
        typeof style === "function" ? style(state) : style,
        !props.disabled &&
          (hovered || focused || state.pressed) && {
            backgroundColor: theme.colors.surface2,
          },
      ]}
    />
  );
}

const NIGHT_TONE = "#8b5cf6";
const TIMED_TONE = "#0d9488";

/** When a scheduled draft starts: the night window, or a set time. */
function TimingChip({
  timing,
  t,
  theme,
}: {
  timing: TaskTiming;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
}) {
  const night = timing.kind === "night";
  const tone = supplementalColor(
    theme,
    night ? "#6d28d9" : "#0f766e",
    night ? "#a78bfa" : "#2dd4bf",
  );
  return (
    <View
      style={[
        styles.timingChip,
        {
          borderColor: tone,
          backgroundColor: `${night ? NIGHT_TONE : TIMED_TONE}1f`,
        },
      ]}
    >
      <Icon name={night ? "Moon" : "Clock"} size={12} color={tone} />
      <Text numberOfLines={1} style={[styles.cardMeta, { color: tone }]}>
        {timing.kind === "night"
          ? t.night.badge
          : new Date(timing.at).toLocaleString(t.locale, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
      </Text>
    </View>
  );
}

/** A power-off is counting down; the user can still cancel it. */
function ShutdownBanner({
  at,
  t,
  theme,
  disabled,
  onCancel,
}: {
  at: string;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  disabled: boolean;
  onCancel(): void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [at]);
  const seconds = Math.max(0, Math.ceil((new Date(at).getTime() - now) / 1000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.shutdownBanner,
        {
          borderColor: theme.colors.statusDanger,
          backgroundColor: `${theme.colors.statusDanger}22`,
        },
      ]}
    >
      <Icon name="Power" size={16} color={theme.colors.statusDanger} />
      <Text style={[styles.shutdownText, { color: theme.colors.foreground }]}>
        {t.night.poweringOff.replace("{time}", clock)}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onCancel}
        style={[
          styles.toolbarButton,
          disabled && styles.disabledControl,
          { backgroundColor: theme.colors.statusDanger },
        ]}
      >
        <Text style={{ color: theme.colors.surface0, fontWeight: "600" }}>
          {t.night.cancel}
        </Text>
      </Pressable>
    </View>
  );
}

export function TaskCard({
  card,
  board,
  icons,
  t,
  theme,
  disabled,
  pending,
  onOpen,
  onEdit,
  onStart,
  onOpenAgent,
  onRefine,
  onReview,
  onFinish,
  onStatus,
  onArchive,
  onCancelBinding,
  onDetachDraft,
  onUndo,
  onOpenPanel,
  onOpenAgentInPanel,
  onContextMenu,
  compact = false,
  dragHandle = null,
  selected = false,
  selectionActive = false,
  onSelect,
  onLongPressSelect,
  packageName = null,
  testTier,
  suspect = false,
  onAddToPackage,
  onRemoveFromPackage,
  onAskPmToGroup,
  selectionCount = 0,
  onDelete,
}: {
  card: Card;
  board: Board;
  icons: ProjectIcons;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  disabled: boolean;
  pending: boolean;
  onOpen(): void;
  onEdit(): void;
  onStart(): void;
  onOpenAgent(agentId: string): void;
  onRefine(): void;
  onReview(outcome: "done" | "continue", feedback: string): Promise<boolean>;
  onFinish(step: FinishStep): void;
  onStatus(): void;
  onArchive(): void;
  onCancelBinding(): void;
  onDetachDraft(draftId: string): void;
  onUndo?(): Promise<void>;
  /** CUSTOM(task-panel): open this ticket in the right-hand panel. */
  onOpenPanel?(): void;
  /** CUSTOM(task-panel): middle click on Open agent shows that agent in the panel. */
  onOpenAgentInPanel?(agentId: string): void;
  onContextMenu?(request: CardMenuRequest): void;
  compact?: boolean;
  /** CUSTOM(card-open-agent): the board's drag handle, shown at the end of the action row. */
  dragHandle?: ReactNode;
  // CUSTOM(packages)
  selected?: boolean;
  selectionActive?: boolean;
  onSelect?(event: { nativeEvent?: SelectionModifiers }): void;
  onLongPressSelect?(): void;
  packageName?: string | null;
  testTier?: "restricted" | "gate" | "full";
  suspect?: boolean;
  onAddToPackage?(): void;
  onRemoveFromPackage?(): void;
  onAskPmToGroup?(): void;
  selectionCount?: number;
  /** CUSTOM(delete-task): the context menu's Delete task. */
  onDelete?(): void;
}) {
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [titleHovered, setTitleHovered] = useState(false);
  const toast = useToast();
  const request = card.changeRequest;
  const requestLabel = request
    ? `${request.forge === "gitlab" ? "MR" : "PR"}${request.number === null ? "" : ` ${request.forge === "gitlab" ? "!" : "#"}${request.number}`}`
    : "";
  const isDraft = card.workspaceId === null;
  const displayedDate = card.lastConversationAt
    ? shortDate(card.lastConversationAt, t.locale)
    : null;
  const time =
    card.conversationDisplayEvidence === "none"
      ? t.noConversation
      : card.conversationDisplayEvidence === "unknown" || displayedDate === null
        ? t.unknownConversation
        : card.conversationDisplayEvidence === "lower-bound"
          ? t.conversationAtLeast.replace("{date}", displayedDate)
          : card.conversationDisplayEvidence === "upper-bound"
            ? t.conversationAtMost.replace("{date}", displayedDate)
            : displayedDate;
  const reason = card.conversationReason
    ? t.conversationReasons[card.conversationReason]
    : null;
  const terminal = isTerminalGroup(card.stage, board.settings.groups);
  const issue =
    card.issue === "no-conversation" || card.issue === "conversation-unknown"
      ? null
      : issueText(card.issue, t);
  const normalLabels = card.labels.filter(
    (label) => !card.managedLabels.includes(label),
  );
  const group = board.settings.groups.find((item) => item.id === card.stage);
  const reasons = attentionReasons(card).map((reason) => {
    if (reason === "waiting" || reason === "error" || reason === "attention")
      return t.attentionActivity[reason];
    if (reason === "checks-failure") return t.checks.failure;
    if (reason === "changes-requested") return t.reviews.changes_requested;
    return issueText(reason, t) ?? reason;
  });
  const pinHint = card.pinState === "automatic" ? t.pinAutomatic : t.pinManual;
  const titleParts = splitTitleArea(card.title);
  // CUSTOM(card-open-agent): Open agent shows in every column while the task has an agent. The
  // orchestration line carries it when it shows (not in review); otherwise it gets its own line.
  const record = board.orchestrations[card.id];
  const inReview = !isDraft && !card.binding && group?.kind === "review";
  const project = board.projects.find((item) => item.id === card.projectId);
  const projectAccent = project?.accent;
  const agentId = cardAgentId(card, record);
  const standaloneAgentLink = !!agentId && (inReview || !record);
  // CUSTOM(task-panel): middle click and the context menu open the side panel; left click keeps
  // every existing behavior. Native has neither pointer event, so a long press opens the same menu.
  const openPanel = onOpenPanel ?? (() => {});
  const menuAt = (x: number, y: number) =>
    onContextMenu?.({
      x,
      y,
      items: cardMenuItems({
        card,
        agentId,
        t,
        disabled,
        onOpenPanel: openPanel,
        onOpen,
        onOpenAgent,
        onEdit,
        onStatus,
        packageName,
        onAddToPackage,
        onRemoveFromPackage,
        onAskPmToGroup,
        selectionCount,
        onDelete,
      }),
    });
  const pointerRef = useCardPointerActions({
    onMiddleClick: openPanel,
    onContextMenu: ({ x, y }) => menuAt(x, y),
  });
  const openMenu = (event: { nativeEvent: { pageX: number; pageY: number } }) =>
    menuAt(event.nativeEvent.pageX, event.nativeEvent.pageY);
  const cardStyle = [
    styles.card,
    {
      backgroundColor: theme.colors.surface0,
      borderColor: theme.colors.border,
      ...(onUndo && compact
        ? {
            outlineColor: theme.colors.accent,
            outlineWidth: 2,
            outlineStyle: "solid" as const,
          }
        : {}),
      ...(selected
        ? {
            outlineColor: theme.colors.accent,
            outlineWidth: 2,
            outlineStyle: "solid" as const,
          }
        : {}),
      borderLeftColor: card.projectId
        ? projectAccentColor(projectAccent, card.projectId, theme)
        : theme.colors.border,
    },
  ];
  const content = (
    <>
      {onUndo && (
        <HintButton
          hint={t.undoMoveHint}
          accessibilityRole="button"
          accessibilityLabel={t.undoMove}
          testID={`workboard-undo-${card.id}`}
          disabled={disabled || pending}
          onPress={() => void onUndo()}
          style={styles.iconAction}
        >
          <Icon name="Undo2" size={14} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.accent }}>{t.undoMove}</Text>
        </HintButton>
      )}
      <View style={styles.cardTitleRow}>
        {/* CUSTOM(card-title-area): the title opens the task's description in every column (the
            workspace still opens from Open agent and the attention line), and the hint shows the
            whole saved title, which the card clips to two lines and may show without its area. */}
        <HintButton
          hint={card.title}
          onHoverIn={() => setTitleHovered(true)}
          onHoverOut={() => setTitleHovered(false)}
          onLongPress={Platform.OS === "web" ? undefined : openMenu}
          accessibilityRole="button"
          accessibilityLabel={`${isDraft ? t.edit : t.notes}: ${card.title}`}
          onPress={(event) => {
            const native = event.nativeEvent as typeof event.nativeEvent & {
              ctrlKey?: boolean;
              metaKey?: boolean;
              shiftKey?: boolean;
            };
            const web = event as unknown as {
              ctrlKey?: boolean;
              metaKey?: boolean;
              shiftKey?: boolean;
            };
            const modifiers = {
              ctrlKey: native.ctrlKey ?? web.ctrlKey,
              metaKey: native.metaKey ?? web.metaKey,
              shiftKey: native.shiftKey ?? web.shiftKey,
            };
            if (
              onSelect &&
              (selectionActive ||
                modifiers.ctrlKey ||
                modifiers.metaKey ||
                modifiers.shiftKey)
            ) {
              onSelect({ nativeEvent: modifiers });
              return;
            }
            onEdit();
          }}
          style={styles.cardTitlePressable}
        >
          <Text
            numberOfLines={2}
            style={[
              styles.cardTitle,
              { color: theme.colors.foreground },
              titleHovered && { textDecorationLine: "underline" },
            ]}
          >
            {titleParts.title}
          </Text>
        </HintButton>
        {pending && (
          <View
            accessible
            accessibilityLabel={t.syncing}
            testID={`workboard-task-${card.id}-syncing`}
          >
            <Icon
              name="LoaderCircle"
              size={13}
              color={theme.colors.foregroundMuted}
            />
          </View>
        )}
      </View>
      <View style={styles.cardProjectRow}>
        {card.projectId && card.projectName ? (
          <ProjectIcon
            name={project?.name ?? card.projectName}
            color={projectAccentColor(projectAccent, card.projectId, theme)}
            fillColor={projectLetterFill(
              project?.letterFill,
              projectAccent,
              card.projectId,
            )}
            icon={projectIconFor(icons, card.projectId)}
          />
        ) : null}
        <Text
          numberOfLines={1}
          style={[
            styles.cardMeta,
            styles.cardProjectText,
            { color: theme.colors.foregroundMuted },
          ]}
        >
          {card.projectName || t.unassigned}
          {titleParts.area ? ` · ${titleParts.area}` : ""}
          {normalLabels.length ? ` · ${normalLabels.join(" · ")}` : ""}
        </Text>
      </View>
      {(packageName || (testTier && testTier !== "full") || suspect) && (
        <View style={styles.cardChips}>
          {packageName && (
            <View
              style={[styles.cardChip, { borderColor: theme.colors.border }]}
            >
              <Icon
                name="Package"
                size={11}
                color={theme.colors.foregroundMuted}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.cardChipText,
                  { color: theme.colors.foregroundMuted },
                ]}
              >
                {packageName}
              </Text>
            </View>
          )}
          {testTier && testTier !== "full" && (
            <Text
              style={[
                styles.cardChip,
                styles.cardChipText,
                {
                  borderColor:
                    testTier === "gate"
                      ? theme.colors.statusWarning
                      : theme.colors.border,
                  color:
                    testTier === "gate"
                      ? theme.colors.statusWarning
                      : theme.colors.foregroundMuted,
                },
              ]}
            >
              {t.packages.tier[testTier]}
            </Text>
          )}
          {suspect && (
            <Text
              style={[
                styles.cardChip,
                styles.cardChipText,
                {
                  borderColor: theme.colors.statusDanger,
                  color: theme.colors.statusDanger,
                },
              ]}
            >
              {t.packages.suspect}
            </Text>
          )}
        </View>
      )}
      {card.timing && <TimingChip timing={card.timing} t={t} theme={theme} />}
      {request && (
        <View style={styles.changeRequest}>
          <ExternalLink
            href={request.url}
            accessibilityLabel={`${requestLabel} · ${t.changeRequestStates[request.state]}: ${request.title}`}
            onError={() => toast.error(t.openChangeRequestError)}
          >
            <View style={styles.requestLink}>
              <Icon
                name={changeRequestIcon(request.state)}
                size={14}
                color={changeRequestColor(request.state, theme)}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.requestTitle,
                  { color: theme.colors.foreground },
                ]}
              >
                {requestLabel}
              </Text>
            </View>
          </ExternalLink>
          <View style={styles.requestStatuses}>
            {request.checksStatus && request.checksStatus !== "none" && (
              <HintButton
                hint={t.checks[request.checksStatus]}
                accessibilityRole="button"
                accessibilityLabel={t.checks[request.checksStatus]}
                style={styles.requestStatusAction}
              >
                <Icon
                  name={checksIcon(request.checksStatus)}
                  size={14}
                  color={checksColor(request.checksStatus, theme)}
                />
              </HintButton>
            )}
            {request.reviewDecision && (
              <HintButton
                hint={t.reviews[request.reviewDecision]}
                accessibilityRole="button"
                accessibilityLabel={t.reviews[request.reviewDecision]}
                style={styles.requestStatusAction}
              >
                <Icon
                  name={reviewIcon(request.reviewDecision)}
                  size={14}
                  color={reviewColor(request.reviewDecision, theme)}
                />
              </HintButton>
            )}
          </View>
        </View>
      )}
      {card.changeRequestUnavailable && (
        <Text style={[styles.cardMeta, { color: theme.colors.statusWarning }]}>
          {t.changeRequestUnavailable}
        </Text>
      )}
      {!isDraft && !card.binding && group?.kind === "done" && (
        <FinishActions
          card={card}
          board={board}
          t={t}
          theme={theme}
          disabled={disabled}
          onFinish={onFinish}
        />
      )}
      {inReview ? (
        <ReviewPrompt
          card={card}
          board={board}
          t={t}
          theme={theme}
          disabled={disabled}
          onReview={onReview}
        />
      ) : (
        <OrchestrationLine
          card={card}
          board={board}
          t={t}
          theme={theme}
          onOpenAgent={onOpenAgent}
          onOpenAgentInPanel={onOpenAgentInPanel}
        />
      )}
      {standaloneAgentLink && agentId && (
        <View style={styles.cardFooter}>
          <Icon name="Bot" size={13} color={theme.colors.foregroundMuted} />
          <OpenAgentLink
            t={t}
            theme={theme}
            onPress={() => onOpenAgent(agentId)}
            onMiddleClick={
              onOpenAgentInPanel ? () => onOpenAgentInPanel(agentId) : undefined
            }
          />
        </View>
      )}
      <View style={styles.cardBottom}>
        {isDraft ? (
          <Text
            style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
          >
            {t.noWorkspace}
          </Text>
        ) : (
          <HintButton
            hint={
              reasons.length
                ? reasons.join(" · ")
                : `${t.activity[card.activity]} · ${time}`
            }
            accessibilityRole="button"
            accessibilityLabel={
              reasons.length
                ? `${t.attentionReason}: ${reasons.join(" · ")}`
                : `${t.activity[card.activity]} · ${time}`
            }
            style={styles.cardFooter}
          >
            <Icon
              name="MessageCircle"
              size={13}
              color={activityColor(card.activity, theme)}
            />
            <Text
              style={[
                styles.cardMeta,
                { color: activityColor(card.activity, theme) },
              ]}
            >
              {t.activity[card.activity]}
            </Text>
            <Text
              style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
            >
              {time}
            </Text>
          </HintButton>
        )}
        <View style={styles.cardActions}>
          {card.number > 0 ? (
            <Text
              style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
            >
              {`#${card.number}`}
            </Text>
          ) : null}
          {/* CUSTOM(factory): the pipeline stage chip, `spec · gate` or `implement 2/3`. */}
          {card.stageChip ? (
            <Text
              numberOfLines={1}
              style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
            >
              {card.stageChip}
            </Text>
          ) : null}
          {!isDraft && (
            <CardAction
              theme={theme}
              hint={agentsOpen ? t.hideDetails : t.details}
              accessibilityRole="button"
              accessibilityLabel={agentsOpen ? t.hideDetails : t.details}
              accessibilityState={{ expanded: agentsOpen }}
              aria-expanded={agentsOpen}
              onPress={() => setAgentsOpen((value) => !value)}
              style={({ pressed }) => [
                styles.iconAction,
                pressed && { backgroundColor: theme.colors.surface2 },
              ]}
            >
              <Icon
                name={agentsOpen ? "ChevronUp" : "ChevronDown"}
                size={14}
                color={theme.colors.foregroundMuted}
              />
            </CardAction>
          )}
          {(isDraft || card.binding) && (
            <CardAction
              theme={theme}
              hint={card.binding ? t.resumeBinding : t.startHint}
              accessibilityRole="button"
              accessibilityLabel={card.binding ? t.retry : t.start}
              disabled={disabled}
              onPress={onStart}
              style={({ pressed }) => [
                styles.startAction,
                { opacity: disabled ? 0.5 : 1 },
                pressed && { backgroundColor: theme.colors.surface2 },
              ]}
            >
              <Icon
                name="Play"
                size={15}
                color={
                  disabled
                    ? theme.colors.foregroundMuted
                    : theme.colors.foreground
                }
              />
              <Text
                style={[
                  styles.cardMeta,
                  {
                    color: disabled
                      ? theme.colors.foregroundMuted
                      : theme.colors.foreground,
                  },
                ]}
              >
                {card.binding ? t.retry : t.start}
              </Text>
            </CardAction>
          )}
          {isDraft && !card.binding && (
            <CardAction
              theme={theme}
              hint={t.refineHint}
              accessibilityRole="button"
              accessibilityLabel={t.refine}
              disabled={disabled}
              onPress={onRefine}
              style={({ pressed }) => [
                styles.startAction,
                { opacity: disabled ? 0.5 : 1 },
                pressed && { backgroundColor: theme.colors.surface2 },
              ]}
            >
              <Icon
                name="MessagesSquare"
                size={15}
                color={
                  disabled
                    ? theme.colors.foregroundMuted
                    : theme.colors.foreground
                }
              />
              <Text
                style={[
                  styles.cardMeta,
                  {
                    color: disabled
                      ? theme.colors.foregroundMuted
                      : theme.colors.foreground,
                  },
                ]}
              >
                {board.refinements[card.id] ? t.refineOpen : t.refine}
              </Text>
            </CardAction>
          )}
          {card.mergedDrafts.map((source) => (
            <CardAction
              theme={theme}
              hint={`${t.detachDraft}: ${source.title}`}
              key={source.draftId}
              accessibilityRole="button"
              accessibilityLabel={`${t.detachDraft}: ${source.title}`}
              disabled={disabled}
              onPress={() => onDetachDraft(source.draftId)}
              style={styles.startAction}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.cardMeta,
                  { color: theme.colors.foreground, flexShrink: 1 },
                ]}
              >
                {t.detachDraft}: {source.title}
              </Text>
            </CardAction>
          ))}
          {card.binding && (
            <CardAction
              theme={theme}
              hint={t.cancelBinding}
              accessibilityRole="button"
              accessibilityLabel={t.cancelBinding}
              disabled={disabled}
              onPress={onCancelBinding}
              style={({ pressed }) => [
                styles.iconAction,
                { opacity: disabled ? 0.5 : 1 },
                pressed && { backgroundColor: theme.colors.surface2 },
              ]}
            >
              <Icon name="X" size={15} color={theme.colors.foregroundMuted} />
            </CardAction>
          )}
          {!isDraft && (
            <CardAction
              theme={theme}
              hint={t.notes}
              accessibilityRole="button"
              accessibilityLabel={t.notes}
              disabled={disabled}
              onPress={onEdit}
              style={({ pressed }) => [
                styles.iconAction,
                { opacity: disabled ? 0.5 : 1 },
                pressed && { backgroundColor: theme.colors.surface2 },
              ]}
            >
              <Icon
                name="FileText"
                size={15}
                color={theme.colors.foregroundMuted}
              />
            </CardAction>
          )}
          <CardAction
            theme={theme}
            hint={t.status}
            accessibilityRole="button"
            accessibilityLabel={t.status}
            disabled={
              disabled ||
              pending ||
              card.binding !== null ||
              card.archived !== null
            }
            onPress={onStatus}
            style={({ pressed }) => [
              styles.iconAction,
              {
                opacity:
                  disabled || pending || card.binding || card.archived
                    ? 0.5
                    : 1,
              },
              pressed && { backgroundColor: theme.colors.surface2 },
            ]}
          >
            <Icon
              name="ArrowRightLeft"
              size={15}
              color={theme.colors.foregroundMuted}
            />
          </CardAction>
          {isDraft &&
            groupKind(card.stage, board.settings.groups) === "canceled" && (
              <CardAction
                theme={theme}
                hint={t.archiveDraft}
                accessibilityRole="button"
                accessibilityLabel={t.archiveDraft}
                disabled={disabled}
                onPress={onArchive}
                style={({ pressed }) => [
                  styles.iconAction,
                  { opacity: disabled ? 0.5 : 1 },
                  pressed && { backgroundColor: theme.colors.surface2 },
                ]}
              >
                <Icon
                  name="Archive"
                  size={15}
                  color={theme.colors.foregroundMuted}
                />
              </CardAction>
            )}
          {/* CUSTOM(card-open-agent): pin and move live here so the title gets the card's width. */}
          {card.pinState !== "none" && (
            <HintButton
              hint={pinHint}
              accessibilityRole="button"
              accessibilityLabel={pinHint}
              style={styles.iconAction}
            >
              <Icon name="Pin" size={13} color={theme.colors.foregroundMuted} />
            </HintButton>
          )}
          {Platform.OS !== "web" && onContextMenu && (
            <HintButton
              hint={t.packages.menu}
              accessibilityRole="button"
              accessibilityLabel={t.packages.menu}
              onPress={(event) =>
                menuAt(event.nativeEvent.pageX, event.nativeEvent.pageY)
              }
              style={styles.iconAction}
            >
              <Icon
                name="MoreHorizontal"
                size={13}
                color={theme.colors.foregroundMuted}
              />
            </HintButton>
          )}
          {dragHandle}
        </View>
      </View>
      {terminal && card.dueAt && (
        <Text
          style={[
            styles.cardMeta,
            {
              color:
                new Date(card.dueAt).getTime() < Date.now()
                  ? theme.colors.statusWarning
                  : theme.colors.foregroundMuted,
            },
          ]}
        >
          {new Date(card.dueAt).getTime() < Date.now()
            ? t.overdue
            : t.expires.replace("{date}", shortDate(card.dueAt, t.locale))}
        </Text>
      )}
      {issue && (
        <Text style={[styles.cardMeta, { color: theme.colors.statusWarning }]}>
          {issue}
        </Text>
      )}
      {agentsOpen && reasons.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text
            style={[styles.cardMeta, { color: theme.colors.statusWarning }]}
          >
            {t.attentionReason}: {reasons.join(" · ")}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={card.stage === "conflict" ? onStatus : onOpen}
            disabled={card.stage === "conflict" && disabled}
            style={styles.reasonAction}
          >
            <Text
              style={[
                styles.cardMeta,
                {
                  color: theme.colors.foreground,
                  textDecorationLine: "underline",
                },
              ]}
            >
              {card.stage === "conflict" ? t.resolveConflict : t.openWorkspace}
            </Text>
            <Icon
              name="ArrowUpRight"
              size={13}
              color={theme.colors.foregroundMuted}
            />
          </Pressable>
        </View>
      )}
      {agentsOpen && card.pinState !== "none" && (
        <Text
          style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
        >
          {pinHint}
        </Text>
      )}
      {agentsOpen && request && (
        <>
          <Text style={[styles.cardMeta, { color: theme.colors.foreground }]}>
            {request.title}
          </Text>
          <Text
            style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
          >
            {t.changeRequestStates[request.state]}
            {request.checksStatus && request.checksStatus !== "none"
              ? ` · ${t.checks[request.checksStatus]}`
              : ""}
            {request.reviewDecision
              ? ` · ${t.reviews[request.reviewDecision]}`
              : ""}
          </Text>
        </>
      )}
      {agentsOpen && normalLabels.length > 0 && (
        <Text
          style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
        >
          {normalLabels.join(" · ")}
        </Text>
      )}
      {agentsOpen &&
        card.agents.map((agent) => (
          <Text
            key={agent.id}
            style={{ color: activityColor(agent.activity, theme) }}
          >
            • {agent.title} · {t.activity[agent.activity]}
          </Text>
        ))}
    </>
  );
  if (Platform.OS !== "web")
    return (
      <Pressable
        ref={pointerRef}
        accessible={false}
        onLongPress={
          onLongPressSelect
            ? () => onLongPressSelect()
            : onContextMenu
              ? openMenu
              : undefined
        }
        style={cardStyle}
      >
        {content}
      </Pressable>
    );
  return (
    <View ref={pointerRef} style={cardStyle}>
      {content}
    </View>
  );
}
function TaskModal({
  disabled,
  pending,
  form,
  board,
  icons,
  t,
  theme,
  onClose,
  onSave,
}: {
  disabled: boolean;
  pending: boolean;
  form: DraftForm;
  board: Board;
  icons: ProjectIcons;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onClose(): void;
  onSave(form: NonNullable<DraftForm>): void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [orchestratorId, setOrchestratorId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [whenKind, setWhenKind] = useState<"ready" | "night" | "at">("ready");
  const [atText, setAtText] = useState("");
  const [inserting, setInserting] = useState(false);
  const selection = useRef<{ start: number; end: number } | null>(null);
  // CUSTOM(workboard-images): pasted images upload to the daemon and land in the description as
  // Markdown references. Saving waits for uploads so a reference is never lost.
  const [uploads, setUploads] = useState(0);
  const [imageError, setImageError] = useState<string | null>(null);
  const saveImage = useRpc(saveImageRpc);
  const pasteRef = useImagePaste(
    (pasted: PastedImages) => void attachImages(pasted),
    !disabled,
  );
  async function attachImages({ images, selection }: PastedImages) {
    setImageError(null);
    if (images.some((image) => image.size > IMAGE_MAX_BYTES)) {
      setImageError(t.imageTooLarge);
      return;
    }
    setUploads((count) => count + 1);
    try {
      const paths: string[] = [];
      for (const image of images) {
        const saved = await saveImage({
          mimeType: image.type,
          base64: await blobToBase64(image),
        });
        paths.push(saved.path);
      }
      setDescription((current) => insertImageRefs(current, selection, paths));
    } catch (failure) {
      setImageError(
        t.imageUploadFailed +
          (failure instanceof Error ? failure.message : String(failure)),
      );
    } finally {
      setUploads((count) => count - 1);
    }
  }
  useEffect(() => {
    if (form) {
      setTitle(form.title);
      setDescription(form.description);
      setProjectId(form.projectId);
      setOrchestratorId(form.orchestratorId ?? null);
      setStage(form.stage ?? null);
      const now = new Date();
      setWhenKind(form.timing?.kind ?? "ready");
      setAtText(
        form.timing?.kind === "at"
          ? formatLocalDateTime(form.timing.at)
          : defaultAtText(now),
      );
      setInserting(false);
      selection.current = null;
      setImageError(null);
    }
  }, [form]);
  if (!form) return null;
  const linked = form.task?.workspaceId !== null && form.task !== undefined;
  const parsedAt =
    whenKind === "at" ? parseLocalDateTime(atText, new Date()) : null;
  const atError = parsedAt && !parsedAt.ok ? parsedAt.error : null;
  const saveDisabled =
    disabled ||
    pending ||
    uploads > 0 ||
    (!linked && !title.trim()) ||
    (!linked && atError !== null);
  const groups = orderedGroups(board.settings);
  const draftGroup =
    groups.find((group) => group.id === form.stage) ??
    groups.find((group) => group.kind === "todo");
  const readyGroup = groups.find((group) => group.kind === "ready");
  const submit = () => {
    if (saveDisabled) return;
    onSave({
      ...form,
      title: linked ? form.task!.title : title.trim(),
      description,
      projectId,
      orchestratorId,
      stage: stage ?? undefined,
      timing: linked
        ? undefined
        : whenKind === "night"
          ? { kind: "night" }
          : parsedAt?.ok
            ? { kind: "at", at: parsedAt.iso }
            : null,
    });
  };
  const submitOnCtrlEnter = (event: { nativeEvent: unknown }) => {
    const key = event.nativeEvent as {
      key?: string;
      ctrlKey?: boolean;
      metaKey?: boolean;
    };
    if (key.key === "Enter" && (key.ctrlKey || key.metaKey)) submit();
  };
  const insertText = (text: string) =>
    setDescription((current) => {
      const { start, end } = selection.current ?? {
        start: current.length,
        end: current.length,
      };
      const before = current.slice(0, start);
      const lead = before.length === 0 || before.endsWith("\n") ? "" : "\n";
      return `${before}${lead}${text}${current.slice(end)}`;
    });
  const insertOptions = [
    ...(Platform.OS === "web"
      ? [
          {
            label: t.taskModal.insertImage,
            icon: "ImagePlus",
            run: () =>
              void pickImages().then((images) => {
                if (images.length === 0) return;
                const at = selection.current ?? {
                  start: description.length,
                  end: description.length,
                };
                void attachImages({ images, selection: at });
              }),
          },
        ]
      : []),
    {
      label: t.taskModal.insertChecklist,
      icon: "ListChecks",
      run: () => insertText("- [ ] "),
    },
    {
      label: t.taskModal.insertCriteria,
      icon: "CircleCheck",
      run: () => insertText(`## ${t.taskModal.criteriaHeading}\n\n- [ ] `),
    },
    {
      label: t.taskModal.insertOutOfScope,
      icon: "Ban",
      run: () => insertText(`## ${t.taskModal.outOfScopeHeading}\n\n- `),
    },
  ];
  return (
    <Modal
      open
      title={
        form.task
          ? `${t.edit}${form.task.number > 0 ? ` #${form.task.number}` : ""}`
          : t.addTask
      }
      onOpenChange={(open) => !open && !pending && onClose()}
    >
      <Modal.Content
        scrollable={false}
        {...LARGE_MODAL}
        contentContainerStyle={styles.taskModalBody}
      >
        <TextInput
          accessibilityLabel={t.titleField}
          autoFocus={!linked}
          editable={!linked && !disabled}
          value={linked ? form.task!.title : title}
          onChangeText={setTitle}
          onKeyPress={submitOnCtrlEnter}
          placeholder={t.titleField}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[
            styles.input,
            styles.taskTitleInput,
            {
              color: theme.colors.foreground,
              borderColor: theme.colors.border,
            },
          ]}
        />
        <TextInput
          ref={pasteRef}
          editable={!disabled}
          accessibilityLabel={t.description}
          value={description}
          onChangeText={setDescription}
          onSelectionChange={(event) =>
            (selection.current = event.nativeEvent.selection)
          }
          onKeyPress={submitOnCtrlEnter}
          multiline
          placeholder={t.description}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[
            styles.input,
            styles.taskDescription,
            {
              color: theme.colors.foreground,
              borderColor: theme.colors.border,
            },
          ]}
        />
        <View style={styles.insertRow}>
          <HintButton
            hint={t.taskModal.insert}
            accessibilityRole="button"
            accessibilityLabel={t.taskModal.insert}
            accessibilityState={{ expanded: inserting }}
            disabled={disabled}
            onPress={() => setInserting((value) => !value)}
            style={[
              styles.insertButton,
              {
                borderColor: theme.colors.border,
                backgroundColor: inserting
                  ? theme.colors.surface2
                  : theme.colors.surface1,
              },
            ]}
          >
            <Icon
              name={inserting ? "X" : "Plus"}
              size={15}
              color={theme.colors.foreground}
            />
          </HintButton>
          {inserting &&
            insertOptions.map((option) => (
              <Pressable
                key={option.label}
                accessibilityRole="button"
                onPress={() => {
                  setInserting(false);
                  option.run();
                }}
                style={[styles.chip, styles.insertChip]}
              >
                <Icon
                  name={option.icon}
                  size={13}
                  color={theme.colors.foregroundMuted}
                />
                <Text style={{ color: theme.colors.foreground }}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          <Text
            numberOfLines={1}
            style={[
              styles.imageHint,
              styles.insertHint,
              {
                color: imageError
                  ? theme.colors.statusDanger
                  : theme.colors.foregroundMuted,
              },
            ]}
          >
            {imageError ??
              (uploads > 0
                ? t.uploadingImage
                : Platform.OS === "web"
                  ? `${t.pasteImageHint} · ${t.taskModal.saveHint}`
                  : "")}
          </Text>
        </View>
        {/* CUSTOM(workboard-images) */}
        <DescriptionImages
          text={description}
          editable={!disabled}
          theme={theme}
          labels={{ remove: t.removeImage, missing: t.imageMissing }}
          onRemove={(ref) => setDescription(removeImageRef(description, ref))}
        />
        <ScrollView
          style={styles.taskChoices}
          contentContainerStyle={styles.taskChoicesContent}
        >
          <Text
            style={[
              styles.choiceLabel,
              { color: theme.colors.foregroundMuted },
            ]}
          >
            {t.taskModal.project}
          </Text>
          <View style={styles.wrapChoices}>
            {[{ id: null, name: t.unassigned }, ...board.projects].map(
              (project) => {
                const selected = projectId === project.id;
                const color = project.id
                  ? projectAccentColor(project.accent, project.id, theme)
                  : theme.colors.foregroundMuted;
                return (
                  <Pressable
                    accessibilityRole="button"
                    {...toggleButtonState(selected)}
                    key={project.id ?? "none"}
                    disabled={disabled || linked}
                    onPress={() => setProjectId(project.id)}
                    style={[
                      styles.chip,
                      styles.colorChip,
                      (disabled || linked) && styles.disabledControl,
                      {
                        borderColor: selected ? color : theme.colors.border,
                        backgroundColor: selected
                          ? `${color}2e`
                          : "transparent",
                      },
                    ]}
                  >
                    {project.id ? (
                      <ProjectIcon
                        name={project.name}
                        color={color}
                        fillColor={projectLetterFill(
                          project.letterFill,
                          project.accent,
                          project.id,
                        )}
                        size={14}
                        icon={projectIconFor(icons, project.id)}
                      />
                    ) : (
                      <View
                        style={[styles.colorDot, { backgroundColor: color }]}
                      />
                    )}
                    <Text
                      style={{
                        color: theme.colors.foreground,
                        fontWeight: selected ? "600" : "400",
                      }}
                    >
                      {project.name}
                    </Text>
                  </Pressable>
                );
              },
            )}
          </View>
          {board.orchestrators.length > 0 && (
            <>
              <Text
                style={[
                  styles.choiceLabel,
                  { color: theme.colors.foregroundMuted },
                ]}
              >
                {t.taskModal.orchestrator}
              </Text>
              <View style={styles.wrapChoices}>
                {[
                  { id: null, name: t.orchestratorAutomatic },
                  ...board.orchestrators,
                ].map((item) => {
                  const selected = orchestratorId === item.id;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${t.orchestrator}: ${item.name}`}
                      {...toggleButtonState(selected)}
                      key={item.id ?? "automatic"}
                      disabled={disabled}
                      onPress={() => setOrchestratorId(item.id)}
                      style={[
                        styles.chip,
                        styles.colorChip,
                        disabled && styles.disabledControl,
                        {
                          borderColor: selected
                            ? theme.colors.accent
                            : theme.colors.border,
                          backgroundColor: selected
                            ? theme.colors.surface2
                            : "transparent",
                        },
                      ]}
                    >
                      <Icon
                        name={item.id ? "Bot" : "Shuffle"}
                        size={13}
                        color={theme.colors.foregroundMuted}
                      />
                      <Text style={{ color: theme.colors.foreground }}>
                        {item.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
          {!linked && (
            <>
              <Text
                style={[
                  styles.choiceLabel,
                  { color: theme.colors.foregroundMuted },
                ]}
              >
                {t.taskModal.when}
              </Text>
              <View style={styles.wrapChoices}>
                {(
                  [
                    ["ready", t.taskModal.whenReady, "Play"],
                    ["night", t.taskModal.whenNight, "Moon"],
                    ["at", t.taskModal.whenAt, "Clock"],
                  ] as const
                ).map(([kind, label, icon]) => {
                  const selected = whenKind === kind;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      {...toggleButtonState(selected)}
                      key={kind}
                      disabled={disabled}
                      onPress={() => setWhenKind(kind)}
                      style={[
                        styles.chip,
                        styles.colorChip,
                        disabled && styles.disabledControl,
                        {
                          borderColor: selected
                            ? theme.colors.accent
                            : theme.colors.border,
                          backgroundColor: selected
                            ? theme.colors.surface2
                            : "transparent",
                        },
                      ]}
                    >
                      <Icon
                        name={icon}
                        size={13}
                        color={theme.colors.foregroundMuted}
                      />
                      <Text style={{ color: theme.colors.foreground }}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {whenKind === "at" && (
                <>
                  <TextInput
                    accessibilityLabel={t.taskModal.whenAt}
                    editable={!disabled}
                    value={atText}
                    onChangeText={setAtText}
                    placeholder="YYYY-MM-DD HH:MM"
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={[
                      styles.atInput,
                      {
                        color: theme.colors.foreground,
                        borderColor: atError
                          ? theme.colors.statusDanger
                          : theme.colors.border,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.imageHint,
                      {
                        color: atError
                          ? theme.colors.statusDanger
                          : theme.colors.foregroundMuted,
                      },
                    ]}
                  >
                    {atError === "invalid"
                      ? t.taskModal.atInvalid
                      : atError === "past"
                        ? t.taskModal.atPast
                        : t.taskModal.atHint}
                  </Text>
                </>
              )}
            </>
          )}
        </ScrollView>
        <View style={styles.taskFooter}>
          {!form.task && readyGroup && whenKind !== "ready" ? (
            <Text
              style={[
                styles.imageHint,
                { color: theme.colors.foregroundMuted },
              ]}
            >
              {t.taskModal.goesToScheduled}
            </Text>
          ) : !form.task && readyGroup ? (
            <View style={styles.wrapChoices}>
              <Text
                style={[
                  styles.choiceLabel,
                  { color: theme.colors.foregroundMuted },
                ]}
              >
                {t.taskModal.createIn}
              </Text>
              {[draftGroup, readyGroup].map((group) =>
                group ? (
                  <Pressable
                    key={group.id}
                    accessibilityRole="button"
                    {...toggleButtonState(
                      (stage ?? draftGroup?.id) === group.id,
                    )}
                    disabled={disabled}
                    onPress={() => setStage(group.id)}
                    style={[
                      styles.chip,
                      styles.colorChip,
                      {
                        borderColor:
                          (stage ?? draftGroup?.id) === group.id
                            ? groupColor(group, theme)
                            : theme.colors.border,
                        backgroundColor:
                          (stage ?? draftGroup?.id) === group.id
                            ? `${groupColor(group, theme)}2e`
                            : "transparent",
                      },
                    ]}
                  >
                    <Text style={{ color: theme.colors.foreground }}>
                      {groupTitle(group, t)}
                    </Text>
                  </Pressable>
                ) : null,
              )}
            </View>
          ) : (
            <View />
          )}
          <View style={styles.modalActions}>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={onClose}
              style={[styles.toolbarButton, pending && styles.disabledControl]}
            >
              <Text style={{ color: theme.colors.foregroundMuted }}>
                {t.cancel}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: pending }}
              disabled={saveDisabled}
              style={[
                styles.toolbarButton,
                styles.saveButton,
                {
                  backgroundColor: saveDisabled
                    ? theme.colors.surface2
                    : theme.colors.accent,
                },
                saveDisabled && styles.disabledControl,
              ]}
              onPress={submit}
            >
              <Text
                style={[
                  styles.primary,
                  {
                    color: saveDisabled
                      ? theme.colors.foregroundMuted
                      : theme.colors.accentForeground,
                  },
                ]}
              >
                {pending ? t.working : form.task ? t.update : t.create}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
function StartModal({
  disabled,
  pending,
  stage,
  card,
  board,
  icons,
  t,
  theme,
  onClose,
  onStart,
}: {
  disabled: boolean;
  pending: boolean;
  card: Card | null;
  stage?: Stage;
  board: Board;
  icons: ProjectIcons;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onClose(): void;
  onStart(
    target: Extract<Mutation, { action: "start" }>["target"],
    stage: Stage,
  ): void;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [projectId, setProjectId] = useState("");
  const [sourceKind, setSourceKind] = useState<"directory" | "worktree">(
    "directory",
  );
  const [existing, setExisting] = useState("");
  const [directory, setDirectory] = useState("");
  const [worktreeSlug, setWorktreeSlug] = useState("");
  useEffect(() => {
    if (!card) return;
    setMode("new");
    setProjectId(card.projectId ?? "");
    setSourceKind("directory");
    setExisting("");
    setDirectory(
      board.projects.find((project) => project.id === card.projectId)
        ?.directory ?? "",
    );
    setWorktreeSlug("");
  }, [card]);
  if (!card) return null;
  const existingCards = board.cards.filter(
    (item) => item.workspaceId && !item.archived && !item.binding,
  );
  const project = board.projects.find((item) => item.id === projectId);
  const targetStage =
    card.binding?.stage ??
    stage ??
    defaultStartWorkGroup(
      board.settings.groups,
      board.settings.defaultStartWorkGroup,
    );
  const hasTarget =
    !!targetStage &&
    board.settings.groups.some((group) => group.id === targetStage);
  const valid =
    card.binding ||
    (mode === "existing"
      ? existing
      : sourceKind === "directory"
        ? directory.trim()
        : project?.isGit);
  const missing = [
    !hasTarget ? t.noStartGroup : null,
    !card.binding && mode === "existing" && !existing
      ? t.startNeedsWorkspace
      : null,
    !card.binding &&
    mode === "new" &&
    sourceKind === "directory" &&
    !directory.trim()
      ? t.startNeedsDirectory
      : null,
    !card.binding &&
    mode === "new" &&
    sourceKind === "worktree" &&
    !project?.isGit
      ? t.startNeedsGitProject
      : null,
  ].filter(Boolean);
  const startDisabled = disabled || pending || !valid || !hasTarget;
  const start = () => {
    if (!targetStage) return;
    if (card.binding) onStart(card.binding.target, targetStage);
    else if (mode === "existing" && existing)
      onStart({ kind: "existing", workspaceId: existing }, targetStage);
    else if (sourceKind === "directory" && directory.trim())
      onStart(
        {
          kind: "new",
          source: {
            kind: "directory",
            path: directory.trim(),
            projectId: projectId || undefined,
          },
        },
        targetStage,
      );
    else if (sourceKind === "worktree" && projectId)
      onStart(
        {
          kind: "new",
          source: {
            kind: "worktree",
            projectId,
            worktreeSlug: worktreeSlug.trim() || undefined,
          },
        },
        targetStage,
      );
  };
  return (
    <Modal
      open
      title={t.start}
      onOpenChange={(open) => !open && !pending && onClose()}
    >
      <Modal.Content>
        {card.binding ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>
            {t.resumeBinding}
          </Text>
        ) : (
          <>
            <View style={styles.modeRow}>
              <Pressable
                accessibilityRole="button"
                {...toggleButtonState(mode === "new")}
                disabled={disabled}
                onPress={() => setMode("new")}
                style={[
                  styles.toolbarButton,
                  disabled && styles.disabledControl,
                ]}
              >
                <Text
                  style={{
                    color:
                      mode === "new"
                        ? theme.colors.foreground
                        : theme.colors.foregroundMuted,
                  }}
                >
                  {t.newWorkspace}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                {...toggleButtonState(mode === "existing")}
                disabled={disabled}
                onPress={() => setMode("existing")}
                style={[
                  styles.toolbarButton,
                  disabled && styles.disabledControl,
                ]}
              >
                <Text
                  style={{
                    color:
                      mode === "existing"
                        ? theme.colors.foreground
                        : theme.colors.foregroundMuted,
                  }}
                >
                  {t.existingWorkspace}
                </Text>
              </Pressable>
            </View>
            {mode === "existing" ? (
              <ScrollView style={styles.choiceList}>
                {existingCards.length ? (
                  existingCards.map((item) => (
                    <Pressable
                      accessibilityRole="button"
                      {...toggleButtonState(item.workspaceId === existing)}
                      key={item.id}
                      disabled={disabled}
                      onPress={() => setExisting(item.workspaceId!)}
                      style={[
                        styles.choice,
                        disabled && styles.disabledControl,
                        item.workspaceId === existing && {
                          backgroundColor: theme.colors.surface2,
                        },
                      ]}
                    >
                      <Text style={{ color: theme.colors.foreground }}>
                        {item.title}
                      </Text>
                      <Text style={{ color: theme.colors.foregroundMuted }}>
                        {item.projectName || t.unassigned} ·{" "}
                        {item.stage === "conflict"
                          ? t.conflict
                          : stageTitle(item.stage, board.settings.groups, t)}
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={{ color: theme.colors.foregroundMuted }}>
                    {t.empty}
                  </Text>
                )}
              </ScrollView>
            ) : (
              <>
                <Text style={{ color: theme.colors.foregroundMuted }}>
                  {t.selectProject}
                </Text>
                <ScrollView style={styles.choiceList}>
                  {board.projects.map((item) => (
                    <Pressable
                      accessibilityRole="button"
                      {...toggleButtonState(item.id === projectId)}
                      key={item.id}
                      disabled={disabled}
                      onPress={() => {
                        setProjectId(item.id);
                        setDirectory(item.directory);
                        if (!item.isGit) setSourceKind("directory");
                      }}
                      style={[
                        styles.choice,
                        disabled && styles.disabledControl,
                        item.id === projectId && {
                          backgroundColor: theme.colors.surface2,
                        },
                      ]}
                    >
                      <View style={styles.projectChoiceRow}>
                        <ProjectIcon
                          name={item.name}
                          color={projectAccentColor(
                            item.accent,
                            item.id,
                            theme,
                          )}
                          fillColor={projectLetterFill(
                            item.letterFill,
                            item.accent,
                            item.id,
                          )}
                          size={14}
                          icon={projectIconFor(icons, item.id)}
                        />
                        <Text style={{ color: theme.colors.foreground }}>
                          {item.name}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={styles.modeRow}>
                  <Pressable
                    accessibilityRole="button"
                    {...toggleButtonState(sourceKind === "directory")}
                    disabled={disabled}
                    onPress={() => setSourceKind("directory")}
                    style={[
                      styles.toolbarButton,
                      disabled && styles.disabledControl,
                    ]}
                  >
                    <Text
                      style={{
                        color:
                          sourceKind === "directory"
                            ? theme.colors.foreground
                            : theme.colors.foregroundMuted,
                      }}
                    >
                      {t.directory}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    {...toggleButtonState(sourceKind === "worktree")}
                    disabled={disabled || !project?.isGit}
                    onPress={() => setSourceKind("worktree")}
                    style={[
                      styles.toolbarButton,
                      (disabled || !project?.isGit) && styles.disabledControl,
                    ]}
                  >
                    <Text
                      style={{
                        color:
                          sourceKind === "worktree"
                            ? theme.colors.foreground
                            : theme.colors.foregroundMuted,
                      }}
                    >
                      {t.worktree}
                    </Text>
                  </Pressable>
                </View>
                {sourceKind === "directory" ? (
                  <TextInput
                    accessibilityLabel={t.directory}
                    editable={!disabled}
                    value={directory}
                    onChangeText={setDirectory}
                    placeholder={t.directory}
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={[
                      styles.input,
                      {
                        color: theme.colors.foreground,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  />
                ) : (
                  <TextInput
                    accessibilityLabel={t.worktreeName}
                    editable={!disabled}
                    value={worktreeSlug}
                    onChangeText={setWorktreeSlug}
                    placeholder={t.worktreeName}
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={[
                      styles.input,
                      {
                        color: theme.colors.foreground,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  />
                )}
              </>
            )}
          </>
        )}
        {missing.length > 0 && (
          <Text
            testID="workboard-start-missing"
            accessibilityRole="alert"
            style={{ color: theme.colors.statusWarning }}
          >
            {missing.join("\n")}
          </Text>
        )}
        <View style={styles.modalActions}>
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={onClose}
            style={[styles.toolbarButton, pending && styles.disabledControl]}
          >
            <Text style={{ color: theme.colors.foregroundMuted }}>
              {t.cancel}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: pending }}
            disabled={startDisabled}
            onPress={start}
            style={[
              styles.toolbarButton,
              startDisabled && styles.disabledControl,
            ]}
          >
            <Text
              style={[
                styles.primary,
                {
                  color: startDisabled
                    ? theme.colors.foregroundMuted
                    : theme.colors.foreground,
                },
              ]}
            >
              {pending ? t.working : card.binding ? t.retry : t.start}
            </Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
function StageModal({
  groups,
  disabled,
  card,
  t,
  theme,
  onClose,
  onStage,
}: {
  disabled: boolean;
  card: Card | null;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onClose(): void;
  onStage(card: Card, stage: Stage): Promise<boolean>;
  groups: Group[];
}) {
  if (!card) return null;
  return (
    <Modal open title={t.status} onOpenChange={(open) => !open && onClose()}>
      <Modal.Content>
        <ScrollView style={styles.choiceList}>
          {groups.map((group) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: card.stage === group.id }}
              disabled={disabled}
              key={group.id}
              onPress={() => void onStage(card, group.id)}
              style={({ pressed }) => [
                styles.stageMenuItem,
                {
                  backgroundColor:
                    card.stage === group.id
                      ? theme.colors.accent
                      : pressed
                        ? theme.colors.surface2
                        : "transparent",
                },
              ]}
            >
              <View
                style={[
                  styles.stageDot,
                  { backgroundColor: groupColor(group, theme) },
                ]}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.menuItemLabel,
                  {
                    color: disabled
                      ? theme.colors.foregroundMuted
                      : card.stage === group.id
                        ? theme.colors.accentForeground
                        : theme.colors.foreground,
                  },
                ]}
              >
                {stageTitle(group.id, groups, t)}
              </Text>
              {card.stage === group.id && (
                <Icon
                  name="Check"
                  size={16}
                  color={
                    disabled
                      ? theme.colors.foregroundMuted
                      : theme.colors.accentForeground
                  }
                />
              )}
            </Pressable>
          ))}
        </ScrollView>
      </Modal.Content>
    </Modal>
  );
}
function PageHeader({
  title,
  t,
  theme,
  onBack,
}: {
  title: string;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onBack?(): void;
}) {
  return (
    <View style={[styles.pageHeader, { borderColor: theme.colors.border }]}>
      {onBack && (
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [
            styles.toolbarButton,
            pressed && { backgroundColor: theme.colors.surface2 },
          ]}
        >
          <Icon
            name="ArrowLeft"
            size={16}
            color={theme.colors.foregroundMuted}
          />
          <Text
            style={[
              styles.controlText,
              { color: theme.colors.foregroundMuted },
            ]}
          >
            {t.back}
          </Text>
        </Pressable>
      )}
      <Text style={[styles.heading, { color: theme.colors.foreground }]}>
        {title}
      </Text>
    </View>
  );
}
export function ArchivePage({
  board,
  cards,
  t,
  theme,
  onBack,
  disabled,
  mutate,
}: {
  board: Board;
  cards: Card[];
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onBack(): void;
  disabled: boolean;
  mutate(input: Mutation): Promise<Board | undefined>;
}) {
  const [resolving, setResolving] = useState<{
    card: Card;
    outcome: "confirm" | "restore";
  } | null>(null);
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.surface0 }]}>
      <PageHeader title={t.archived} t={t} theme={theme} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.compactList}>
        {cards.length ? (
          cards.map((card) => (
            <View
              key={card.id}
              style={[
                styles.card,
                {
                  backgroundColor: theme.colors.surface1,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <Text
                style={[styles.cardTitle, { color: theme.colors.foreground }]}
              >
                {card.title}
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted }}>
                {card.archived?.group
                  ? groupTitle(card.archived.group, t)
                  : stageTitle(
                      card.archived?.stage ?? card.stage,
                      board.settings.groups,
                      t,
                    )}{" "}
                ·{" "}
                {card.archived?.detail === "archive-confirmed-by-user"
                  ? t.archiveConfirmedByUser
                  : card.archived?.detail}
              </Text>
              {(card.archived?.status === "uncertain" ||
                card.archived?.status === "external") && (
                <Text
                  selectable
                  style={{ color: theme.colors.foregroundMuted }}
                >
                  ID: {card.archived.operationId}
                </Text>
              )}
              <View style={styles.cardFooter}>
                {archiveOutcomes(card).map((outcome) => (
                  <Pressable
                    key={outcome}
                    accessibilityRole="button"
                    disabled={disabled}
                    onPress={() => setResolving({ card, outcome })}
                    style={styles.toolbarButton}
                  >
                    <Text style={{ color: theme.colors.foreground }}>
                      {outcome === "confirm"
                        ? t.confirmArchived
                        : t.restoreTask}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ color: theme.colors.foregroundMuted }}>
                {card.archived?.archivedAt
                  ? shortDate(card.archived.archivedAt, t.locale)
                  : card.archived?.status}
              </Text>
            </View>
          ))
        ) : (
          <Text style={{ color: theme.colors.foregroundMuted }}>{t.empty}</Text>
        )}
      </ScrollView>
      {resolving && (
        <ConfirmationModal
          title={
            resolving.outcome === "confirm" ? t.confirmArchived : t.restoreTask
          }
          description={(resolving.outcome === "confirm"
            ? t.confirmArchivedConfirm
            : t.restoreTaskConfirm
          ).replace("{name}", resolving.card.title)}
          confirmLabel={
            resolving.outcome === "confirm" ? t.confirmArchived : t.restoreTask
          }
          disabled={disabled}
          t={t}
          theme={theme}
          onClose={() => setResolving(null)}
          onConfirm={async () =>
            !!(await mutate({
              action: "resolve-archive",
              taskId: resolving.card.id,
              updatedAt: resolving.card.updatedAt,
              operationId: resolving.card.archived!.operationId,
              outcome: resolving.outcome,
            }))
          }
        />
      )}
    </View>
  );
}
export function SettingsPage({
  board,
  t,
  theme,
  disabled,
  saving,
  pendingMutationIds,
  mutate,
  onBack,
}: {
  board: Board;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  disabled: boolean;
  saving: boolean;
  pendingMutationIds?: ReadonlySet<string>;
  mutate(
    mutation: Mutation,
    pendingMutationId?: string,
  ): Promise<Board | undefined>;
  onBack?(): void;
}) {
  const [confirmed, setConfirmed] = useState({
    settings: board.settings,
    revision: board.revision,
  });
  const [archiveDaysEdit, setArchiveDaysEdit] = useState<{
    base: number;
    text: string;
  } | null>(null);
  // CUSTOM(unattended-automation): scratch-folder settings edit the same way archive days do.
  const [tmpPathEdit, setTmpPathEdit] = useState<{
    base: string;
    text: string;
  } | null>(null);
  const [tmpHoursEdit, setTmpHoursEdit] = useState<{
    base: number;
    text: string;
  } | null>(null);
  const [confirmAutoArchive, setConfirmAutoArchive] = useState(false);
  const current =
    board.revision > confirmed.revision
      ? { settings: board.settings, revision: board.revision }
      : confirmed;
  const settings = current.settings;
  const groups = settings.groups;
  const daysText =
    archiveDaysEdit?.base === settings.archiveAfterDays
      ? archiveDaysEdit.text
      : String(settings.archiveAfterDays);
  const validDays =
    /^\d+$/.test(daysText) && Number(daysText) >= 0 && Number(daysText) <= 365;
  const tmpPathText =
    tmpPathEdit?.base === settings.tmpCleanup.path
      ? tmpPathEdit.text
      : settings.tmpCleanup.path;
  const tmpHoursText =
    tmpHoursEdit?.base === settings.tmpCleanup.maxAgeHours
      ? tmpHoursEdit.text
      : String(settings.tmpCleanup.maxAgeHours);
  const validTmpHours =
    /^\d+$/.test(tmpHoursText) &&
    Number(tmpHoursText) >= 1 &&
    Number(tmpHoursText) <= 8760;
  const preview = mappingPreview(board.cards, settings, Date.now());
  // CUSTOM(factory): in active mode the columns and housekeeping are saved to the factory; the
  // default-column preferences stay in the board.
  const factoryOwned = factoryOwnsConfig(board.factory);
  const controlDisabled = (id: string) =>
    disabled || !!pendingMutationIds?.has(`settings:${id}`);
  const persist = async (next: Settings, control = "groups") => {
    const result = await mutate(
      {
        action: "settings",
        revision: current.revision,
        expectedSettings: current.settings,
        settings: next,
      },
      `settings:${control}`,
    );
    if (result)
      setConfirmed({ settings: result.settings, revision: result.revision });
    return result;
  };
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.surface0 }]}>
      <PageHeader title={t.settingsTitle} t={t} theme={theme} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.settings}>
        <View style={styles.settingsContent}>
          {factoryOwned && (
            <Text
              style={[styles.hintText, { color: theme.colors.foregroundMuted }]}
            >
              {t.factory.writes}
            </Text>
          )}
          <SettingsSection title={t.generalSettings}>
            <SettingsCard>
              <SettingsSwitch
                label={t.pinInProgressWorkspaces}
                hint={t.pinInProgressHint}
                value={settings.pinInProgressWorkspaces}
                onValueChange={async (value) => {
                  await persist(
                    {
                      ...settings,
                      pinInProgressWorkspaces: value,
                    },
                    "pin",
                  );
                }}
                disabled={controlDisabled("pin")}
                testID="workboard-pin-in-progress"
              />
              <SettingsSwitch
                label={t.autoArchive}
                hint={[
                  settings.archiveAfterDays === 0
                    ? t.autoArchiveHintNow
                    : t.autoArchiveHint.replace(
                        "{days}",
                        String(settings.archiveAfterDays),
                      ),
                  settings.archiveMappingNeedsReview
                    ? t.autoArchiveMigrationPaused
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n")}
                value={settings.autoArchive}
                onValueChange={async (value) => {
                  if (value && preview.due > 0) {
                    setConfirmAutoArchive(true);
                    return;
                  }
                  await persist({ ...settings, autoArchive: value }, "archive");
                }}
                disabled={controlDisabled("archive")}
                testID="workboard-auto-archive"
              />
              <SettingsInput
                key={settings.archiveAfterDays}
                label={t.archiveAfterDays}
                hint={t.archiveAfterDaysHint}
                initialValue={String(settings.archiveAfterDays)}
                onChangeText={(text) =>
                  setArchiveDaysEdit({ base: settings.archiveAfterDays, text })
                }
                error={validDays ? null : t.archiveAfterDaysInvalid}
                disabled={controlDisabled("days")}
                testID="workboard-archive-days"
              />
              <SettingsAction
                label={t.archiveAfterDays}
                actionLabel={t.save}
                onPress={async () => {
                  if (
                    validDays &&
                    (await persist(
                      {
                        ...settings,
                        archiveAfterDays: Number(daysText),
                      },
                      "days",
                    ))
                  )
                    setArchiveDaysEdit(null);
                }}
                disabled={
                  controlDisabled("days") ||
                  !validDays ||
                  Number(daysText) === settings.archiveAfterDays
                }
                testID="workboard-save-archive-days"
              />
              <SettingsSelect
                label={t.defaultDraftGroupSetting}
                value={
                  groups.some(
                    (group) =>
                      group.id === settings.defaultDraftGroup &&
                      group.kind === "todo",
                  )
                    ? settings.defaultDraftGroup!
                    : ""
                }
                options={[
                  { value: "", label: t.defaultByKind },
                  ...groups
                    .filter((group) => group.kind === "todo")
                    .map((group) => ({
                      value: group.id,
                      label: groupTitle(group, t),
                    })),
                ]}
                onValueChange={async (value) => {
                  await persist(
                    {
                      ...settings,
                      defaultDraftGroup: value || null,
                    },
                    "draft-default",
                  );
                }}
                disabled={controlDisabled("draft-default")}
                testID="workboard-default-draft"
              />
              <SettingsSelect
                label={t.defaultStartGroupSetting}
                value={
                  groups.some(
                    (group) =>
                      group.id === settings.defaultStartGroup &&
                      !isTerminalGroup(group.id, groups),
                  )
                    ? settings.defaultStartGroup!
                    : ""
                }
                options={[
                  { value: "", label: t.defaultByKind },
                  ...groups
                    .filter((group) => !isTerminalGroup(group.id, groups))
                    .map((group) => ({
                      value: group.id,
                      label: groupTitle(group, t),
                    })),
                ]}
                onValueChange={async (value) => {
                  await persist(
                    {
                      ...settings,
                      defaultStartGroup: value || null,
                    },
                    "workspace-default",
                  );
                }}
                disabled={controlDisabled("workspace-default")}
                testID="workboard-default-workspace"
              />
              <SettingsSelect
                label={t.defaultStartWorkGroupSetting}
                value={
                  groups.some(
                    (group) =>
                      group.id === settings.defaultStartWorkGroup &&
                      group.kind === "in-progress",
                  )
                    ? settings.defaultStartWorkGroup!
                    : ""
                }
                options={[
                  { value: "", label: t.defaultByKind },
                  ...groups
                    .filter((group) => group.kind === "in-progress")
                    .map((group) => ({
                      value: group.id,
                      label: groupTitle(group, t),
                    })),
                ]}
                onValueChange={async (value) => {
                  await persist(
                    { ...settings, defaultStartWorkGroup: value || null },
                    "start-work-default",
                  );
                }}
                disabled={controlDisabled("start-work-default")}
                testID="workboard-default-start-work"
              />
            </SettingsCard>
          </SettingsSection>
          <SettingsSection title={t.tmpCleanupTitle}>
            <SettingsCard>
              <SettingsInput
                key={settings.tmpCleanup.path}
                label={t.tmpCleanupPath}
                hint={t.tmpCleanupPathHint}
                initialValue={settings.tmpCleanup.path}
                onChangeText={(text) =>
                  setTmpPathEdit({ base: settings.tmpCleanup.path, text })
                }
                disabled={controlDisabled("tmp-path")}
                testID="workboard-tmp-path"
              />
              <SettingsInput
                key={settings.tmpCleanup.maxAgeHours}
                label={t.tmpCleanupHours}
                hint={t.tmpCleanupHoursHint}
                initialValue={String(settings.tmpCleanup.maxAgeHours)}
                onChangeText={(text) =>
                  setTmpHoursEdit({
                    base: settings.tmpCleanup.maxAgeHours,
                    text,
                  })
                }
                error={validTmpHours ? null : t.tmpCleanupInvalid}
                disabled={controlDisabled("tmp-hours")}
                testID="workboard-tmp-hours"
              />
              <SettingsAction
                label={t.tmpCleanupTitle}
                actionLabel={t.save}
                onPress={async () => {
                  if (
                    validTmpHours &&
                    tmpPathText.trim() &&
                    (await persist(
                      {
                        ...settings,
                        tmpCleanup: {
                          path: tmpPathText.trim(),
                          maxAgeHours: Number(tmpHoursText),
                        },
                      },
                      "tmp-cleanup",
                    ))
                  ) {
                    setTmpPathEdit(null);
                    setTmpHoursEdit(null);
                  }
                }}
                disabled={
                  controlDisabled("tmp-cleanup") ||
                  !validTmpHours ||
                  !tmpPathText.trim() ||
                  (tmpPathText.trim() === settings.tmpCleanup.path &&
                    Number(tmpHoursText) === settings.tmpCleanup.maxAgeHours)
                }
                testID="workboard-save-tmp-cleanup"
              />
            </SettingsCard>
          </SettingsSection>
          <GroupSettings
            board={{ ...board, settings }}
            groups={groups}
            onChange={async (next) =>
              !!(await persist({ ...settings, groups: next }))
            }
            disabled={disabled}
            saving={saving}
            t={t}
            theme={theme}
          />
          <View>
            {(settings.autoArchive || preview.affected > 0) && (
              <View style={styles.settingsPreview}>
                <Text
                  style={[
                    styles.hintText,
                    { color: theme.colors.statusWarning },
                  ]}
                >
                  {t.mappingPreview.replace(
                    "{count}",
                    String(preview.affected),
                  )}
                </Text>
                <Text
                  style={[
                    styles.hintText,
                    { color: theme.colors.statusWarning },
                  ]}
                >
                  {t.duePreview.replace("{count}", String(preview.due))}
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
      {confirmAutoArchive && (
        <ConfirmationModal
          title={t.enableAutoArchive}
          description={t.enableAutoArchiveConfirm.replace(
            "{count}",
            String(preview.due),
          )}
          confirmLabel={t.enable}
          disabled={disabled}
          t={t}
          theme={theme}
          onClose={() => setConfirmAutoArchive(false)}
          onConfirm={async () =>
            !!(await persist({ ...settings, autoArchive: true }, "archive"))
          }
        />
      )}
    </View>
  );
}
function issueText(
  issue: string | null,
  t: ReturnType<typeof strings>,
): string | null {
  return issue ? ((t.issues as Record<string, string>)[issue] ?? issue) : null;
}
function bootErrorText(
  error: string | null,
  t: ReturnType<typeof strings>,
): string | null {
  return error
    ? ((t.bootErrors as Record<string, string>)[error] ?? error)
    : null;
}
function activityColor(
  activity: Card["activity"],
  theme: PluginSurfaceProps["theme"],
) {
  return activity === "error"
    ? theme.colors.statusDanger
    : activity === "attention" || activity === "waiting"
      ? theme.colors.statusWarning
      : activity === "running"
        ? theme.colors.foreground
        : theme.colors.foregroundMuted;
}
function changeRequestIcon(
  state: NonNullable<Card["changeRequest"]>["state"],
): string {
  return state === "merged"
    ? "GitMerge"
    : state === "closed"
      ? "GitPullRequestClosed"
      : state === "draft"
        ? "GitPullRequestDraft"
        : "GitPullRequest";
}
function changeRequestColor(
  state: NonNullable<Card["changeRequest"]>["state"],
  theme: PluginSurfaceProps["theme"],
) {
  return state === "merged"
    ? supplementalColor(theme, "#7347af", "#a890d5")
    : state === "closed"
      ? theme.colors.statusDanger
      : state === "open"
        ? theme.colors.statusSuccess
        : theme.colors.foregroundMuted;
}
function checksIcon(
  status: Exclude<NonNullable<Card["changeRequest"]>["checksStatus"], "none">,
) {
  return status === "success"
    ? "CircleCheck"
    : status === "failure"
      ? "CircleX"
      : "CircleDot";
}
function checksColor(
  status: Exclude<NonNullable<Card["changeRequest"]>["checksStatus"], "none">,
  theme: PluginSurfaceProps["theme"],
) {
  return status === "success"
    ? theme.colors.statusSuccess
    : status === "failure"
      ? theme.colors.statusDanger
      : theme.colors.statusWarning;
}
function reviewIcon(
  status: NonNullable<Card["changeRequest"]>["reviewDecision"],
) {
  return status === "approved"
    ? "CircleCheck"
    : status === "changes_requested"
      ? "CircleX"
      : "MessageSquare";
}
function reviewColor(
  status: NonNullable<Card["changeRequest"]>["reviewDecision"],
  theme: PluginSurfaceProps["theme"],
) {
  return status === "approved"
    ? theme.colors.statusSuccess
    : status === "changes_requested"
      ? theme.colors.statusDanger
      : theme.colors.foregroundMuted;
}
const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0 },
  // CUSTOM(task-panel)
  boardRow: { flex: 1, minHeight: 0, flexDirection: "row" },
  boardArea: { flex: 1, minWidth: 0, minHeight: 0 },
  filterSummary: {
    paddingHorizontal: 12,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toolbar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 8,
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  toolbarLeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  toolbarLeadingCompact: { width: "100%" },
  toolbarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
  },
  // CUSTOM(redeploy-button)
  redeployButton: {
    minHeight: 30,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolbarButton: {
    minHeight: 36,
    minWidth: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  controlText: { fontSize: 14, lineHeight: 20 },
  projectPicker: { minWidth: 0, maxWidth: 180, flexShrink: 1 },
  projectPickerCompact: { flex: 1, maxWidth: "100%" },
  projectTrigger: { borderWidth: 1 },
  projectName: { flexShrink: 1 },
  fixedIcon: { flexShrink: 0 },
  pageHeader: {
    minHeight: 60,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "600" },
  primary: { fontWeight: "600", textDecorationLine: "underline" },
  search: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    minWidth: 140,
    maxWidth: 360,
    height: 36,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    padding: 0,
    fontSize: 14,
    lineHeight: 20,
  },
  chip: {
    minHeight: 36,
    minWidth: 36,
    justifyContent: "center",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 7,
  },
  disabledControl: { opacity: 0.5 },
  menuItem: { padding: 12 },
  projectChoiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stageMenuItem: {
    minHeight: 40,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stageDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  menuItemLabel: { flex: 1, minWidth: 0 },
  notice: { paddingHorizontal: 16, paddingTop: 8 },
  conflict: {
    borderWidth: 1,
    borderRadius: 8,
    marginHorizontal: 12,
    marginTop: 8,
    overflow: "hidden",
  },
  conflictRow: {
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  conflictTitle: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18 },
  conflictHint: {
    paddingHorizontal: 10,
    paddingBottom: 6,
    fontSize: 12,
    lineHeight: 18,
  },
  conflictList: { maxHeight: 160 },
  compactList: { padding: 10, gap: 7 },
  tabScroll: { flexGrow: 0, flexShrink: 0, maxHeight: 52 },
  card: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
    gap: 4,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  cardTitlePressable: { flex: 1, minWidth: 0 },
  cardTitle: { fontWeight: "600", fontSize: 14, lineHeight: 18 },
  cardMeta: { fontSize: 12, lineHeight: 16 },
  cardProjectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
  },
  cardProjectText: { flexShrink: 1 },
  timingChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  shutdownBanner: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    margin: 8,
    padding: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  shutdownText: { flex: 1, fontWeight: "600" },
  changeRequest: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  requestLink: { flexDirection: "row", alignItems: "center", gap: 5 },
  requestTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  requestStatuses: {
    flexDirection: "row",
    columnGap: 6,
  },
  requestStatusAction: {
    width: 36,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  reasonAction: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
  },
  cardBottom: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 2,
  },
  cardFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    flexShrink: 1,
    alignItems: "center",
    gap: 5,
  },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    flexShrink: 1,
    maxWidth: "100%",
    alignItems: "center",
    gap: 2,
  },
  filterBadge: {
    minWidth: 18,
    minHeight: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  startAction: {
    maxWidth: "100%",
    minHeight: 36,
    borderRadius: 6,
    paddingHorizontal: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  iconAction: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 40 },
  review: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    gap: 6,
  },
  reviewTitle: { fontSize: 13, fontWeight: "600" },
  finishInline: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  prBox: { gap: 4 },
  taskModalBody: { flex: 1, minHeight: 0, gap: 12 },
  taskTitleInput: { fontSize: 16, fontWeight: "600" },
  taskDescription: {
    flex: 1,
    minHeight: 160,
    textAlignVertical: "top",
    lineHeight: 20,
  },
  insertRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  insertButton: {
    width: 32,
    height: 32,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  insertChip: { flexDirection: "row", alignItems: "center", gap: 5 },
  insertHint: { flexShrink: 1, marginLeft: 4 },
  taskChoices: { flexGrow: 0, flexShrink: 1, maxHeight: 220 },
  taskChoicesContent: { gap: 8 },
  choiceLabel: { fontSize: 12, fontWeight: "600" },
  wrapChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  colorChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 11,
  },
  atInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    minHeight: 36,
    maxWidth: 240,
  },
  colorDot: { width: 8, height: 8, borderRadius: 4 },
  taskFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  saveButton: { borderRadius: 8, paddingHorizontal: 14 },
  reviewInput: { minHeight: 64, textAlignVertical: "top" },
  reviewActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 6,
  },
  reviewButton: {
    minHeight: 30,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  textarea: { minHeight: 92, textAlignVertical: "top" },
  imageHint: { fontSize: 12 }, // CUSTOM(workboard-images)
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 18,
    paddingTop: 8,
  },
  projectChoices: { gap: 6 },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    paddingVertical: 8,
  },
  choiceList: { maxHeight: 220 },
  choice: { padding: 10, borderRadius: 7 },
  settings: { padding: 16, paddingBottom: 24 },
  settingsContent: { width: "100%", maxWidth: 760, alignSelf: "center" },
  settingsPreview: { gap: 4 },
  hintText: { fontSize: 13, lineHeight: 18 },
  packageBar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  viewToggle: { flexDirection: "row", borderWidth: 1, borderRadius: 8 },
  viewToggleButton: { paddingHorizontal: 10, paddingVertical: 6 },
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 260,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  packageUndo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cardChips: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cardChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  cardChipText: { fontSize: 10 },
});

export function mutationErrorText(
  error: unknown,
  t: ReturnType<typeof strings>,
): string {
  if (!(error instanceof Error)) return t.loadError;
  const messages: Record<string, string> = {
    ...t.issues,
    ...t.mutationErrors,
    ...t.bootErrors,
    [CANCEL_BINDING_BUSY_ERROR_CODE]: t.cancelBindingBusy,
  };
  if (Object.hasOwn(messages, error.message)) return messages[error.message]!;
  // A code that carries detail after a colon (`package-branch-merge-failed: <git error>`).
  for (const [code, text] of Object.entries(messages)) {
    const prefix = `${code}: `;
    if (error.message.startsWith(prefix))
      return `${text} ${error.message.slice(prefix.length)}`;
  }
  return t.loadError;
}
