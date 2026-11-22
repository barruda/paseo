// CUSTOM(factory): the PM decides what is its own (#165): pm_card_create refuses a proposal on an
// approved task whose merge is the PM's, the breaker expires a proposal left waiting on the user,
// and the pwb block reads `próximo` as `você` when `seu` asks something of the user.
import { afterEach, describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { Workboard } from "../server/workboard";
import { chatTools } from "../server/assistant/chat";
import type { AssistantReport } from "../shared/assistant-reports";
import {
  AUTONOMY_PRESETS,
  approvedMergeRefusal,
  autonomyRulesText,
  breakerWakeText,
} from "../shared/autonomy";
import { parseReplyBlock } from "../shared/reply-protocol";

const boards: Workboard[] = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.dispose();
});

const START = Date.parse("2026-11-21T02:00:00.000Z");
const MIN = 60_000;

/** A board with one task in project `p`, a PM chat, and report entries the test writes. */
async function setup(options: { critical?: boolean; chat?: boolean } = {}) {
  let clock = START;
  const s = fixture();
  await s.store.load();
  const reports: AssistantReport[] = [];
  const board = new Workboard(s.host, s.store, () => clock, 60000, {
    reports: {
      since: async (_from, filter) =>
        reports.filter((entry) => !filter || filter(entry)),
    },
  });
  boards.push(board);
  await board.start();
  if (options.critical)
    // COMPAT(factory-pipelines): outside active mode the legacy map makes `p` critical.
    await s.store.update((data) => {
      data.assistant.settings.reviews = { p: "fresh-agent" };
    });
  await board.mutate({
    action: "create",
    title: "factory 1",
    description: "x",
    projectId: "p",
  });
  const task = s.store.current.tasks[0]!;
  let chatId: string | null = null;
  if (options.chat ?? true) {
    chatId = await s.host.startAgentIn("/chat", {
      provider: "claude/x",
      modeId: null,
      thinkingOptionId: null,
      title: "Project Manager",
      prompt: "hi",
    });
    s.inventory.agents.find((a) => a.id === chatId)!.activity = "idle";
    await s.store.update((data) => {
      data.assistant.chatAgentId = chatId;
    });
  }
  const report = (kind: AssistantReport["kind"], minutes: number) =>
    reports.push({
      id: `r${reports.length}`,
      at: new Date(START + minutes * MIN).toISOString(),
      taskId: task.id,
      taskTitle: task.title,
      projectId: "p",
      projectName: "Project",
      kind,
      summary: kind,
      detail: null,
      decisions: [],
      orchestrator: null,
      quickMessageId: null,
    });
  const sent = () =>
    (s.host.sendAgent as any).mock.calls.filter(
      ([id]: [string]) => id === chatId,
    ) as [string, string][];
  return {
    board,
    s,
    task,
    chatId,
    report,
    sent,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** The card of the 2026-11-21 incident (pm-c70a91a2): merge ok asked, merge recommended. */
const mergeAsk = (taskId: string, extra: Record<string, unknown> = {}) => ({
  kind: "proposal" as const,
  title: "Faço o merge do factory 1?",
  question: "Merge agora?",
  options: [
    { id: "merge", label: "Merge", gains: null, costs: null },
    { id: "wait", label: "Esperar", gains: null, costs: null },
  ],
  recommend: "merge",
  links: { taskIds: [taskId], reportIds: [], packageIds: [] },
  ...extra,
});

describe("pm_card_create refuses a decision that is the PM's", () => {
  it("refuses a proposal on an approved task of a project whose merge is the PM's", async () => {
    const t = await setup();
    t.report("reviewed", 0);
    expect(t.board.requiresUserMergeOk("p")).toBe(false);
    await expect(
      t.board.pmCardCreate(mergeAsk(t.task.id), "pm"),
    ).rejects.toThrow(/This decision is yours.*approved review.*merge-now/s);
    expect(t.board.pmCards()).toHaveLength(0);
  });

  it("the tool refuses it too, and creates it with a userOnlyReason the preset gives the user", async () => {
    const t = await setup();
    t.report("reviewed", 0);
    const tool = chatTools(() => t.board, {
      list: async () => null,
    } as any).find((entry) => entry.name === "pm_card_create")!;
    const input = {
      ...mergeAsk(t.task.id),
      taskIds: [t.task.id],
      reportIds: [],
      packageIds: [],
      why: null,
      findings: "",
      decision: null,
      action: null,
    };
    const refused = await tool.execute({ ...input, userOnlyReason: null });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused)).toContain("approved review");
    const created = await tool.execute({ ...input, userOnlyReason: "product" });
    expect(created.isError).toBeUndefined();
    expect(t.board.pmCards()[0]).toMatchObject({ userOnlyReason: "product" });
  });

  it("creates the card when the review is not approved: none yet, or feedback after it", async () => {
    const t = await setup();
    await expect(
      t.board.pmCardCreate(mergeAsk(t.task.id), "pm"),
    ).resolves.toMatchObject({ status: "waiting" });
    t.report("reviewed", 0);
    t.report("feedback", 1);
    await expect(
      t.board.pmCardCreate(mergeAsk(t.task.id), "pm"),
    ).resolves.toMatchObject({ status: "waiting" });
  });

  it("leaves a critical project's merge ok and the board's own cards alone", async () => {
    const t = await setup({ critical: true });
    t.report("reviewed", 0);
    expect(t.board.requiresUserMergeOk("p")).toBe(true);
    await expect(
      t.board.pmCardCreate(mergeAsk(t.task.id), "pm"),
    ).resolves.toMatchObject({ status: "waiting" });

    const own = await setup();
    own.report("reviewed", 0);
    await expect(
      own.board.pmCardCreate(mergeAsk(own.task.id)),
    ).resolves.toMatchObject({ status: "waiting" });
  });

  it("the refusal text is generated from the preset data", () => {
    const text = approvedMergeRefusal("standard", false, "#149");
    expect(text).toContain(AUTONOMY_PRESETS.standard.label);
    expect(text).toContain("#149");
    expect(text).toContain("product, irreversible");
  });
});

describe("the breaker", () => {
  it("expires the pm-c70a91a2 card after the standard preset's 15 min and wakes the PM once", async () => {
    const t = await setup();
    // Created before the review approved, so it is not refused.
    const card = await t.board.pmCardCreate(mergeAsk(t.task.id), "pm");
    expect(AUTONOMY_PRESETS.standard.breakerMinutes).toBe(15);
    t.advance(14 * MIN);
    await t.board.checkPmBreaker();
    expect(t.sent()).toHaveLength(0);

    t.advance(MIN);
    await t.board.checkPmBreaker();
    expect(t.sent()).toHaveLength(1);
    const text = t.sent()[0]![1];
    expect(text).toBe(
      breakerWakeText([
        {
          id: card.id,
          title: card.title,
          recommend: "merge",
          waited: "15 min",
        },
      ]),
    );
    expect(text).toContain("pm_card_decide (decidedBy pm");
    expect(t.board.pmCards()[0]!.breakerAt).not.toBeNull();

    // Once: the PM left it waiting again, and the board does not repeat itself.
    t.s.inventory.agents.find((a) => a.id === t.chatId)!.activity = "idle";
    t.advance(30 * MIN);
    await t.board.checkPmBreaker();
    expect(t.sent()).toHaveLength(1);
  });

  it("never expires a card with userOnlyReason, nor wakes the PM for it", async () => {
    const t = await setup({ critical: true });
    await t.board.pmCardCreate(
      mergeAsk(t.task.id, { userOnlyReason: "critical-merge" }),
      "pm",
    );
    t.advance(120 * MIN);
    await t.board.checkPmBreaker();
    await t.board.checkPmBreaker();
    expect(t.sent()).toHaveLength(0);
    expect(t.board.pmCards()[0]).toMatchObject({
      status: "waiting",
      breakerAt: null,
    });
  });

  it("skips a card with no recommendation, a decided card and one the user reopened", async () => {
    const t = await setup();
    await t.board.pmCardCreate(
      mergeAsk(t.task.id, { recommend: null, title: "No recommendation" }),
      "pm",
    );
    const decided = await t.board.pmCardCreate(mergeAsk(t.task.id), "pm");
    await t.board.pmCardDecide(decided.id, { optionId: "merge", by: "user" });
    await t.board.pmCardReopen(decided.id);
    t.advance(60 * MIN);
    await t.board.checkPmBreaker();
    expect(t.sent()).toHaveLength(0);
  });

  it("waits for a busy chat and tries again on the next pass", async () => {
    const t = await setup();
    await t.board.pmCardCreate(mergeAsk(t.task.id), "pm");
    t.s.inventory.agents.find((a) => a.id === t.chatId)!.activity = "running";
    t.advance(16 * MIN);
    await t.board.checkPmBreaker();
    expect(t.sent()).toHaveLength(0);
    expect(t.board.pmCards()[0]!.breakerAt).toBeNull();
    t.s.inventory.agents.find((a) => a.id === t.chatId)!.activity = "idle";
    await t.board.checkPmBreaker();
    expect(t.sent()).toHaveLength(1);
  });

  it("the prompt names each preset's breaker, from the data", () => {
    const text = autonomyRulesText();
    for (const preset of Object.values(AUTONOMY_PRESETS))
      expect(text).toContain(
        `${preset.label} ${preset.breakerMinutes === null ? "none" : `${preset.breakerMinutes} min`}`,
      );
  });
});

describe("pwb: seu wins over próximo", () => {
  it("reads próximo: espera as você when seu asks something of the user", () => {
    const reply = parseReplyBlock(
      "próximo: espera\nseu: aprovar merge do factory 1 [pm:pm-c70a91a2]",
    );
    expect(reply.next?.value).toBe("você");
    expect(reply.yours?.pmCardIds).toEqual(["pm-c70a91a2"]);
  });

  it("keeps próximo when seu is nada, and sets você when only seu is written", () => {
    expect(parseReplyBlock("próximo: espera\nseu: nada").next?.value).toBe(
      "espera",
    );
    expect(parseReplyBlock("seu: testar no app").next?.value).toBe("você");
  });
});
