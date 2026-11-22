// CUSTOM(factory): the revision stamp's worker config hash (docs/factory.md, ticket 5).
import { describe, expect, it } from "vitest";
import {
  compiledWorkerConfigHash,
  workerConfigHash,
} from "../server/factory/stamp";
import { historyEventSchema } from "../shared/assistant";
import {
  orchestrationSchema,
  orchestratorConfigSchema,
  type OrchestratorConfig,
} from "../shared/model";

const config = (over: Partial<OrchestratorConfig> = {}): OrchestratorConfig =>
  orchestratorConfigSchema.parse({
    id: "9d0c2f6e-uuid",
    name: "Paseo",
    projectId: "prj_1",
    instructions: "Run the plugin tests before you finish.",
    skills: { mode: "selected", names: ["paseo", "paseo-advisor"] },
    ...over,
  });
const PROMPT = "You are an execution agent for the paseo project.";

describe("workerConfigHash", () => {
  it("the same config and prompts give the same hash", () => {
    const hash = workerConfigHash({ config: config(), systemPrompt: PROMPT });
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(workerConfigHash({ config: config(), systemPrompt: PROMPT })).toBe(
      hash,
    );
  });

  it("one character changed in the system prompt or the task prompt gives a new hash", () => {
    const hash = workerConfigHash({ config: config(), systemPrompt: PROMPT });
    expect(
      workerConfigHash({
        config: config(),
        systemPrompt: PROMPT.replace("paseo", "pasea"),
      }),
    ).not.toBe(hash);
    expect(
      workerConfigHash({
        config: config({
          instructions: "Run the plugin tests before you finish!",
        }),
        systemPrompt: PROMPT,
      }),
    ).not.toBe(hash);
  });

  it("a model, permission, thinking, skill or role change gives a new hash", () => {
    const hash = workerConfigHash({ config: config(), systemPrompt: PROMPT });
    for (const over of [
      { provider: "claude/claude-sonnet-5-5" },
      { modeId: "plan" },
      { thinkingOptionId: "high" },
      { skills: { mode: "all" as const, names: [] } },
      { memory: false },
    ])
      expect(
        workerConfigHash({ config: config(over), systemPrompt: PROMPT }),
      ).not.toBe(hash);
    expect(
      workerConfigHash({
        config: config(),
        systemPrompt: PROMPT,
        role: "review",
      }),
    ).not.toBe(hash);
    // Implement is the live board's role (every orchestrator implements): same hash as none.
    expect(
      workerConfigHash({
        config: config(),
        systemPrompt: PROMPT,
        role: "implement",
      }),
    ).toBe(hash);
  });

  it("identity, scheduling, key order, skill order and outer whitespace keep the hash", () => {
    const hash = workerConfigHash({ config: config(), systemPrompt: PROMPT });
    const same = (over: Partial<OrchestratorConfig>, prompt = PROMPT) =>
      expect(
        workerConfigHash({ config: config(over), systemPrompt: prompt }),
      ).toBe(hash);
    same({ id: "paseo", name: "Renamed", projectId: null, enabled: false });
    same({ schedule: { kind: "manual" }, maxConcurrent: 4, batchSize: 9 });
    same({ poolId: "night" });
    same({ skills: { mode: "selected", names: ["paseo-advisor", "paseo"] } });
    same({}, `\n${PROMPT}\n\n`);
    const reordered = Object.fromEntries(
      Object.entries(config()).reverse(),
    ) as OrchestratorConfig;
    expect(workerConfigHash({ config: reordered, systemPrompt: PROMPT })).toBe(
      hash,
    );
  });

  it("a worker compiled from the factory hashes like the same live orchestrator", () => {
    expect(
      compiledWorkerConfigHash({
        id: "paseo",
        config: config({ id: "paseo" }),
        // A worker with no role compiles as implement (ticket 6).
        role: "implement",
        priority: 0,
        description: "Paseo worker",
        systemPrompt: PROMPT,
        ownSkills: [],
      }),
    ).toBe(workerConfigHash({ config: config(), systemPrompt: PROMPT }));
  });
});

describe("stamp fields on stored data", () => {
  it("an orchestration written before the stamp parses with null fields", () => {
    const run = orchestrationSchema.parse({
      status: "finished",
      startedAt: "2026-11-01T00:00:00.000Z",
    });
    expect(run).toMatchObject({
      factoryRevision: null,
      workerId: null,
      workerConfigHash: null,
    });
  });

  it("a history event written before the stamp parses with null fields", () => {
    const event = historyEventSchema.parse({
      id: "e1",
      at: "2026-11-01T00:00:00.000Z",
      kind: "task-started",
      taskId: "t1",
      taskTitle: "Task",
      projectId: null,
      projectName: "",
      orchestratorId: "o1",
      orchestratorName: "Paseo",
      agentId: "a1",
      attempt: 1,
      action: null,
      text: "Started",
    });
    expect(event).toMatchObject({
      factoryRevision: null,
      workerId: null,
      workerConfigHash: null,
    });
  });
});
