// CUSTOM(report-card)
import { describe, expect, it } from "vitest";
import {
  REPORT_CARD_KIND,
  REPORT_ITEM_VERSION,
  REPORT_STATUS_LOOK,
  REPORT_TEXT_KIND,
  filesChangedMarkdown,
  reportCardDataSchema,
  reportTextDataSchema,
  reportTimelineItems,
  splitTaskReport,
} from "../shared/task-report";

const report = {
  status: "done",
  summary: "Added the retry button.",
  filesChanged: ["src/button.tsx", "docs/a.md"],
  checks: [
    { command: "npm test", passed: true },
    { command: "npm run lint", passed: false },
  ],
  risks: ["Not tested on iOS."],
  question: null,
  progress: null,
  resumeAfter: null,
  waitingFor: null,
  options: [],
  recommend: null,
  why: null,
  outcomes: [],
  notDone: [],
};
const block = (value: unknown) => `<report>${JSON.stringify(value)}</report>`;

describe("splitTaskReport", () => {
  it("splits the reply around a valid report", () => {
    const split = splitTaskReport(`## Done\n\nAll good.\n\n${block(report)}\n`);
    expect(split).toEqual({
      before: "## Done\n\nAll good.",
      report,
      after: "",
    });
  });

  it("fills the report defaults", () => {
    const split = splitTaskReport(
      block({ status: "failed", summary: "Broke" }),
    );
    expect(split?.report).toEqual({
      status: "failed",
      summary: "Broke",
      filesChanged: [],
      checks: [],
      risks: [],
      question: null,
      progress: null,
      resumeAfter: null,
      waitingFor: null,
      options: [],
      recommend: null,
      why: null,
      outcomes: [],
      notDone: [],
    });
    expect(split?.before).toBe("");
  });

  // CUSTOM(assistant-cards)
  it("reads the question's options and the review map", () => {
    const full = {
      ...report,
      status: "needs_input",
      question: "Which cache?",
      options: [
        { id: "a", label: "Memory", gains: "fast", costs: "lost on restart" },
        { id: "b", label: "Disk" },
      ],
      recommend: "a",
      why: "Restarts are rare",
      outcomes: [
        { ask: "retry on 503", evidence: "seen", detail: "curl → retried" },
        { ask: "no new deps", evidence: "tested" },
      ],
      notDone: [{ kind: "outside", text: "Renamed a helper" }],
    };
    const parsed = splitTaskReport(block(full))?.report;
    expect(parsed?.options).toEqual([
      { id: "a", label: "Memory", gains: "fast", costs: "lost on restart" },
      { id: "b", label: "Disk", gains: null, costs: null },
    ]);
    expect(parsed?.recommend).toBe("a");
    expect(parsed?.outcomes[1]).toEqual({
      ask: "no new deps",
      evidence: "tested",
      detail: null,
    });
    expect(parsed?.notDone).toEqual([
      { kind: "outside", text: "Renamed a helper" },
    ]);
    const card = reportTimelineItems(block(full))?.[0].data;
    expect(reportCardDataSchema.parse(card)).toMatchObject({
      options: parsed?.options,
      recommend: "a",
      why: "Restarts are rare",
      outcomes: parsed?.outcomes,
      notDone: parsed?.notDone,
    });
  });

  it("never loses a report over a malformed new field", () => {
    const parsed = splitTaskReport(
      block({
        status: "done",
        summary: "ok",
        options: "a or b",
        recommend: 3,
        outcomes: [
          { ask: "kept", evidence: "maybe" },
          { evidence: "seen" },
          "loose text",
        ],
        notDone: [{ kind: "later", text: "kept as skipped" }, { kind: "x" }],
      }),
    )?.report;
    expect(parsed?.status).toBe("done");
    expect(parsed?.options).toEqual([]);
    expect(parsed?.recommend).toBeNull();
    expect(parsed?.outcomes).toEqual([
      { ask: "kept", evidence: "unverified", detail: null },
    ]);
    expect(parsed?.notDone).toEqual([
      { kind: "skipped", text: "kept as skipped" },
    ]);
  });

  it("parses cards stored before the new fields", () => {
    const { options, recommend, why, outcomes, notDone, ...old } = report;
    void [options, recommend, why, outcomes, notDone];
    expect(reportCardDataSchema.safeParse(old).success).toBe(true);
  });

  it("keeps the text after the block", () => {
    expect(splitTaskReport(`a ${block(report)} b`)).toMatchObject({
      before: "a",
      after: "b",
    });
  });

  it("uses the last block", () => {
    const first = { ...report, summary: "first" };
    const last = { ...report, summary: "last" };
    expect(
      splitTaskReport(`${block(first)} middle ${block(last)}`)?.report.summary,
    ).toBe("last");
  });

  it("returns null for no block, invalid JSON, or missing fields", () => {
    expect(splitTaskReport("Just text")).toBeNull();
    expect(splitTaskReport("Hi <report>{nope</report>")).toBeNull();
    expect(splitTaskReport(block({ summary: "no status" }))).toBeNull();
    expect(
      splitTaskReport(block({ status: "great", summary: "x" })),
    ).toBeNull();
    expect(splitTaskReport("Hi <report>{}")).toBeNull();
  });

  it("ignores a block quoted in code", () => {
    expect(
      splitTaskReport(`Format:\n\n\`\`\`\n${block(report)}\n\`\`\`\n`),
    ).toBeNull();
    expect(splitTaskReport(`Use \`${block(report)}\` at the end`)).toBeNull();
    expect(
      splitTaskReport(`\`\`\`ts\nx\n\`\`\`\n\nDone.\n${block(report)}`)?.before,
    ).toBe("```ts\nx\n```\n\nDone.");
  });
});

describe("reportTimelineItems", () => {
  it("maps the reply to a text item and a card item", () => {
    const items = reportTimelineItems(`All good.\n${block(report)}`);
    expect(items).toEqual([
      {
        type: "plugin",
        kind: REPORT_TEXT_KIND,
        version: REPORT_ITEM_VERSION,
        data: { text: "All good." },
      },
      {
        type: "plugin",
        kind: REPORT_CARD_KIND,
        version: REPORT_ITEM_VERSION,
        data: report,
      },
    ]);
    expect(reportTextDataSchema.safeParse(items?.[0].data).success).toBe(true);
    expect(reportCardDataSchema.safeParse(items?.[1].data).success).toBe(true);
    // The raw JSON is gone from what the chat renders.
    expect(JSON.stringify(items)).not.toContain("<report>");
  });

  it("emits only the card when the reply is the report alone", () => {
    const items = reportTimelineItems(block(report));
    expect(items?.map((item) => item.kind)).toEqual([REPORT_CARD_KIND]);
  });

  it("emits the text after the report as its own item", () => {
    const items = reportTimelineItems(`before ${block(report)} after`);
    expect(items?.map((item) => item.kind)).toEqual([
      REPORT_TEXT_KIND,
      REPORT_CARD_KIND,
      REPORT_TEXT_KIND,
    ]);
  });

  it("emits rows without ids, so the host keys them by the source reply", () => {
    // A fixed id would collide across replies; the host's keying of id-less rows is tested in
    // packages/app/src/plugins/timeline/projection.test.ts.
    const items = reportTimelineItems(`before ${block(report)} after`) ?? [];
    expect(items).toHaveLength(3);
    for (const item of items) expect(item).not.toHaveProperty("id");
  });

  it("keeps the original reply when the report is invalid", () => {
    expect(reportTimelineItems("Hi <report>{nope</report>")).toBeUndefined();
    expect(reportTimelineItems("No report here")).toBeUndefined();
  });

  it("carries the question of a needs_input report", () => {
    const items = reportTimelineItems(
      block({ status: "needs_input", summary: "Stuck", question: "Which DB?" }),
    );
    expect(items?.[0].data).toMatchObject({
      status: "needs_input",
      question: "Which DB?",
    });
  });

  it("carries the progress and the wait of a checkpoint report", () => {
    const items = reportTimelineItems(
      block({
        status: "checkpoint",
        summary: "Half way",
        progress: { done: ["a"], next: ["b", "c"] },
        resumeAfter: "2026-11-18T09:00:00.000Z",
        waitingFor: "CI",
      }),
    );
    expect(items?.[0].data).toMatchObject({
      status: "checkpoint",
      progress: { done: ["a"], next: ["b", "c"] },
      resumeAfter: "2026-11-18T09:00:00.000Z",
      waitingFor: "CI",
    });
    expect(reportCardDataSchema.safeParse(items?.[0].data).success).toBe(true);
  });

  it("output is JSON-compatible", () => {
    const items = reportTimelineItems(block(report));
    expect(JSON.parse(JSON.stringify(items))).toEqual(items);
  });
});

describe("card presentation", () => {
  it("gives each status its own icon and a tone", () => {
    expect(REPORT_STATUS_LOOK).toEqual({
      done: { tone: "success", icon: "CircleCheck" },
      needs_input: { tone: "warning", icon: "CircleHelp" },
      blocked: { tone: "danger", icon: "Ban" },
      failed: { tone: "danger", icon: "CircleX" },
      checkpoint: { tone: "info", icon: "Flag" },
    });
    const icons = Object.values(REPORT_STATUS_LOOK).map((look) => look.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("lists changed files as inline code so the chat links them", () => {
    expect(filesChangedMarkdown(["src/a.ts", "we`ird.md"])).toBe(
      "- `src/a.ts`\n- `weird.md`",
    );
  });
});
