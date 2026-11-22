import {
  archiveGate,
  isArchiveDue,
  defaultGroup,
  defaultWorkspaceGroup,
  groupKind,
  labelKey,
  type Group,
  resolveStage,
  type Board,
  type Card,
  type Finish,
  type FinishStep,
  type Settings,
  type Stage,
} from "../shared/model";
import { DEFAULT_FILTERS, matchesRequest, type BoardFilters } from "./filters";

const attentionIssues = new Set([
  "labels-conflict",
  "label-sync-incomplete",
  "native-archive-unknown",
  "conversation-unknown",
  "terminal-open",
  "git-dirty",
  "git-no-upstream",
  "git-unpushed",
  "git-unmerged",
  "git-detached",
  "git-unknown",
  "directory-unavailable",
]);

export function attentionReasons(card: Card): string[] {
  const reasons: string[] = [];
  if (["waiting", "error", "attention"].includes(card.activity))
    reasons.push(card.activity);
  if (card.stage === "conflict") reasons.push("labels-conflict");
  if (
    card.issue &&
    attentionIssues.has(card.issue) &&
    !reasons.includes(card.issue)
  )
    reasons.push(card.issue);
  const request = card.changeRequest;
  if (
    !card.changeRequestUnavailable &&
    request &&
    (request.state === "open" || request.state === "draft")
  ) {
    if (request.checksStatus === "failure") reasons.push("checks-failure");
    if (request.reviewDecision === "changes_requested")
      reasons.push("changes-requested");
  }
  return reasons;
}

export function visibleCards(
  board: Board,
  projectId: string,
  search: string,
  attentionOnly: boolean,
  filters: Pick<BoardFilters, "activity" | "changeRequest"> & {
    packageId?: string;
  } = DEFAULT_FILTERS,
  // CUSTOM(task-description-files): the snapshot has no descriptions; the search passes them here.
  descriptions: ReadonlyMap<string, string> = new Map(),
): Card[] {
  const needle = search.trim().toLocaleLowerCase();
  return board.cards.filter(
    (card) =>
      card.archived?.status !== "archived" &&
      card.archived?.status !== "external" &&
      (projectId === "all" ||
        (projectId === "none"
          ? card.projectId === null
          : card.projectId === projectId)) &&
      ((filters.packageId ?? "all") === "all" ||
        (filters.packageId === "none"
          ? card.packageId === null
          : card.packageId === filters.packageId)) &&
      (!attentionOnly || attentionReasons(card).length > 0) &&
      (filters.activity === "all" || card.activity === filters.activity) &&
      matchesRequest(card, filters.changeRequest) &&
      (!needle ||
        `${card.title} ${card.projectName} ${descriptions.get(card.id) ?? ""}`
          .toLocaleLowerCase()
          .includes(needle)),
  );
}

export { cardsForStage } from "../shared/model";

/**
 * Keep a requested move visible while the daemon verifies the label mutation.
 * The server response remains authoritative; this only changes the local board
 * projection and deliberately leaves label data untouched.
 */
export function withOptimisticStages(
  board: Board,
  stages: ReadonlyMap<string, Stage>,
): Board {
  if (stages.size === 0) return board;
  return {
    ...board,
    cards: board.cards.map((card) => {
      const stage = stages.get(card.id);
      return stage === undefined || stage === card.stage
        ? card
        : { ...card, stage };
    }),
  };
}

export function shortDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

/**
 * The finish buttons a Done card offers, and the highlighted one. Once the task is merged its work
 * is in the project, so Commit and Merge go away; the board does not watch the worktree after
 * that, and a change made there later is not offered for another merge. PR description stays as
 * a plain button.
 */
export function finishButtons(
  finish: Pick<Finish, "mergedAt" | "committedAt"> | undefined,
  // CUSTOM(orchestrator-in-place): there is no separate branch to merge.
  inPlace = false,
): {
  steps: FinishStep[];
  primary: FinishStep | null;
} {
  if (finish?.mergedAt) return { steps: ["pr"], primary: null };
  if (inPlace)
    return finish?.committedAt
      ? { steps: ["pr"], primary: null }
      : { steps: ["commit", "pr"], primary: "commit" };
  return { steps: ["commit", "pr", "merge"], primary: "merge" };
}

/**
 * CUSTOM(workboard-finish-inline): a Done card's finish area stacks the status, the PR body and
 * the buttons. With one button and no PR body there is nothing to fill the extra rows, so the
 * status and that button share one line.
 */
export function finishInlineLayout(input: {
  hasStatus: boolean;
  hasPr: boolean;
  steps: number;
}): boolean {
  return input.hasStatus && !input.hasPr && input.steps === 1;
}

/**
 * CUSTOM(card-open-agent): the agent a card's Open agent link opens, in any column and whatever
 * the agent's state. The orchestrated attempt's agent wins (current, or the last one: its record
 * stays after the task moves); a restart that has no agent yet, or a task started by hand, falls
 * back to the workspace's agents, a live one first. A draft has no workspace and no agent.
 */
export function cardAgentId(
  card: Pick<Card, "workspaceId" | "agents">,
  orchestration: { agentId: string | null } | undefined,
): string | null {
  if (orchestration?.agentId) return orchestration.agentId;
  if (card.workspaceId === null) return null;
  return (
    card.agents.find((agent) => !agent.archived)?.id ??
    card.agents[0]?.id ??
    null
  );
}

/**
 * CUSTOM(task-panel): the server's card.agents lists the workspace's agents including archived
 * ones, so on a settled task an id missing from it is an agent that was deleted. Live tasks are
 * skipped because a just-created agent can reach the orchestration record before the inventory.
 */
export function agentGone(
  card: Pick<Card, "workspaceId" | "agents">,
  agentId: string,
  settled: boolean,
): boolean {
  return (
    settled &&
    card.workspaceId !== null &&
    !card.agents.some((agent) => agent.id === agentId)
  );
}

export function stageAtX(
  x: number,
  columns: Partial<Record<Stage, { left: number; right: number }>>,
  stages: readonly Stage[],
): Stage | null {
  const measured = stages.filter((stage) => columns[stage]);
  if (
    !measured.length ||
    x < columns[measured[0]]!.left ||
    x > columns[measured.at(-1)!]!.right
  )
    return null;
  return (
    measured.find((stage, index) => {
      const next = columns[measured[index + 1]];
      return !next || x <= (columns[stage]!.right + next.left) / 2;
    }) ?? null
  );
}

export const DEFAULT_COLUMN_WIDTH = 246;
export const MIN_COLUMN_WIDTH = 220;
export const MAX_COLUMN_WIDTH = 480;
export const columnWidth = (value = DEFAULT_COLUMN_WIDTH) =>
  Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, value)));

export function groupOrderAtX(
  order: readonly string[],
  moving: string,
  x: number,
  columns: Record<string, { left: number; right: number }>,
): string[] {
  const next = order.filter((id) => id !== moving);
  const before = next.findIndex((id) => {
    const bounds = columns[id];
    return bounds && x < (bounds.left + bounds.right) / 2;
  });
  next.splice(before < 0 ? next.length : before, 0, moving);
  return next;
}

export function edgeScrollSpeed(x: number, width: number): number {
  const edge = Math.min(64, width / 4);
  if (x < 0 || x > width) return 0;
  if (x < edge) return -720 * (1 - x / edge);
  if (x > width - edge) return 720 * (1 - (width - x) / edge);
  return 0;
}

export function mappingPreview(
  cards: readonly Card[],
  settings: Settings,
  now: number,
): { affected: number; due: number } {
  return cards.reduce(
    (result, card) => {
      if (
        card.workspaceId === null ||
        card.archived?.status === "archived" ||
        card.archived?.status === "external"
      )
        return result;
      const stage = resolveStage(
        card.labels,
        settings.groups,
        settings.defaultStartGroup,
      );
      if (stage !== card.stage) result.affected += 1;
      if (
        archiveGate(card) !== null &&
        !card.archived &&
        !card.binding &&
        isArchiveDue(
          groupKind(stage, settings.groups),
          archiveGate(card),
          now,
          settings.archiveAfterDays,
        )
      )
        result.due += 1;
      return result;
    },
    { affected: 0, due: 0 },
  );
}

export function groupTasks(cards: readonly Card[], group: Group): Card[] {
  return cards.filter(
    (card) =>
      card.archived?.status !== "archived" &&
      card.archived?.status !== "external" &&
      (card.stage === group.id ||
        card.binding?.stage === group.id ||
        card.labels.some((label) => labelKey(label) === labelKey(group.label))),
  );
}

export function groupDeleteReason(
  cards: readonly Card[],
  groups: readonly Group[],
  group: Group,
  defaults?: Partial<
    Pick<
      Settings,
      "defaultDraftGroup" | "defaultStartGroup" | "defaultStartWorkGroup"
    >
  >,
):
  | "groupDeleteNotEmpty"
  | "groupDefaultInUse"
  | "groupNeedsTodo"
  | "groupNeedsInbox"
  | "groupNeedsCanceled"
  | null {
  const workspaceDefault = defaultWorkspaceGroup(
    groups,
    defaults?.defaultStartGroup,
  );
  if (
    groupTasks(cards, group).some(
      (card) =>
        !card.workspaceId ||
        card.stage !== workspaceDefault ||
        card.labels.some(
          (label) => labelKey(label) === labelKey(group.label),
        ) ||
        card.binding?.stage === group.id ||
        card.issue === "archive-restored-workspace-unavailable",
    )
  )
    return "groupDeleteNotEmpty";
  if (groups.filter((item) => item.kind === group.kind).length === 1) {
    if (group.kind === "todo") return "groupNeedsTodo";
  }
  if (
    group.id === defaultGroup(groups, defaults?.defaultDraftGroup) ||
    group.id === workspaceDefault ||
    group.id === defaults?.defaultStartWorkGroup
  )
    return "groupDefaultInUse";
  return null;
}

/** Move only the selected card around a visible anchor; hidden neighbors keep relative order. */
export function moveCardToAnchor(
  order: readonly string[],
  moving: string,
  anchor: string,
  side: "before" | "after",
): string[] {
  if (moving === anchor || !order.includes(moving) || !order.includes(anchor))
    return [...order];
  const next = order.filter((id) => id !== moving);
  next.splice(next.indexOf(anchor) + (side === "after" ? 1 : 0), 0, moving);
  return next;
}

// CUSTOM(card-title-area): many titles start with an area ("Workboard: ..."), which ate the
// two visible lines of the card. The card shows the rest as its title and the area beside the
// project. Display only: the saved title, search and filters keep the whole text.
const AREA_MAX_WORDS = 4;
const AREA_MAX_LENGTH = 40;
const AREA_FORBIDDEN = /[.,;!?()[\]{}"'`/\\]/;

export function splitTitleArea(title: string): {
  area: string | null;
  title: string;
} {
  const whole = title.trim();
  const colon = whole.indexOf(":");
  // Only the first colon counts, and it must end a word: "10:30" and "https://" never make an area.
  if (colon <= 0 || !/\s/.test(whole.charAt(colon + 1)))
    return { area: null, title: whole };
  const area = whole.slice(0, colon).trim();
  const rest = whole.slice(colon + 1).trim();
  if (
    !rest ||
    area.length > AREA_MAX_LENGTH ||
    area.split(/\s+/).length > AREA_MAX_WORDS ||
    AREA_FORBIDDEN.test(area)
  )
    return { area: null, title: whole };
  return { area, title: rest };
}
