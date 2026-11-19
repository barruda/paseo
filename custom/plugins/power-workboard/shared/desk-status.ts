// CUSTOM(workboard-chip-status): the counts the Power Workboard chip in the app's Desk header shows. The app repeats this contract in packages/app/src/task-navigation/desk-workboard-model.ts; keep the two in step.
import { z } from "zod";
import type { Group, orchestratorStatusSchema } from "./model";
type OrchestratorStatus = z.infer<typeof orchestratorStatusSchema>;

export const deskStatusSchema = z.object({
  running: z.number().int(),
  review: z.number().int(),
  needsYou: z.number().int(),
});
export type DeskStatus = z.infer<typeof deskStatusSchema>;

type DeskStatusBoard = {
  orchestratorStatus: Record<string, Pick<OrchestratorStatus, "running">>;
  settings: { groups: Pick<Group, "id" | "kind">[] };
  cards: {
    id: string;
    stage: string;
    archived?: { status: string } | null;
  }[];
};

const isArchived = (card: { archived?: { status: string } | null }) =>
  card.archived?.status === "archived" || card.archived?.status === "external";

export function deskStatusOf(
  board: DeskStatusBoard,
  deliveries: Record<string, { stage: string }>,
): DeskStatus {
  const reviewStages = new Set(
    board.settings.groups
      .filter((group) => group.kind === "review")
      .map((group) => group.id),
  );
  let running = 0;
  for (const status of Object.values(board.orchestratorStatus))
    running += status.running;
  let review = 0;
  const live = new Set<string>();
  for (const card of board.cards) {
    if (isArchived(card)) continue;
    live.add(card.id);
    if (reviewStages.has(card.stage)) review += 1;
  }
  let needsYou = 0;
  for (const [taskId, delivery] of Object.entries(deliveries))
    if (delivery.stage === "needs-you" && live.has(taskId)) needsYou += 1;
  return { running, review, needsYou };
}
