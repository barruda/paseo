// CUSTOM(factory): the built-in `default` and `critical` pipelines as data, for code that runs in
// the plugin bundle. The YAML files in server/factory/builtin/pipelines/ stay the source the
// export writes; the bundle cannot read them (the daemon runs the plugin as one CommonJS bundle,
// so there is no path to `builtin/`). tests/pipeline-layout.test.ts fails when the two drift.
import type { ReviewPolicy } from "../assistant";
import type { PipelineFile } from "./schema";

export const BUILTIN_PIPELINES = {
  default: {
    description:
      "Today's flow. The worker implements, the Project Manager reviews, then delivery.",
    start: "implement",
    stages: {
      implement: { role: "implement", to: "review" },
      review: {
        role: "pm",
        file: "roles/review.md",
        to: [
          { stage: "deliver", when: "No blocking findings." },
          { stage: "implement", when: "Blocking findings remain." },
        ],
      },
    },
  },
  critical: {
    description:
      "Critical projects. Triage, an approved spec, implementation, verification with evidence and a fresh review.",
    start: "triage",
    stages: {
      triage: {
        role: "triage",
        to: [
          {
            stage: "spec",
            when: "The ticket is large, ambiguous, or changes visible behavior.",
          },
          { stage: "implement", when: "The ticket is small and clear." },
        ],
      },
      spec: {
        role: "spec",
        gate: {
          question: "Approve this spec?",
          options: [
            { id: "approve", label: "Approve", to: "implement" },
            { id: "changes", label: "Request changes", to: "spec" },
          ],
        },
      },
      implement: { role: "implement", to: "verify" },
      verify: {
        role: "verify",
        to: [
          { stage: "review", when: "Every check passed, with evidence." },
          { stage: "implement", when: "A check failed." },
        ],
      },
      review: {
        role: "review",
        session: "fresh",
        to: [
          { stage: "deliver", when: "No blocking findings." },
          { stage: "implement", when: "Blocking findings remain." },
        ],
      },
    },
  },
} satisfies Record<string, PipelineFile>;

export type BuiltinPipelineId = keyof typeof BUILTIN_PIPELINES;

/** The pipeline the migration gives a project: `critical` for the `fresh-agent` review policy. */
export function builtinPipelineFor(policy: ReviewPolicy): BuiltinPipelineId {
  return policy === "fresh-agent" ? "critical" : "default";
}

/**
 * What the Pipelines tab shows while the factory is off: the built-in pipelines and, for each
 * board project, the one its review policy gives it.
 */
export function builtinPipelinesView(reviews: Record<string, ReviewPolicy>): {
  source: "builtin";
  pipelines: Record<string, PipelineFile>;
  projects: Record<string, string>;
  defaultPipeline: string;
} {
  const projects: Record<string, string> = {};
  for (const [projectId, policy] of Object.entries(reviews))
    projects[projectId] = builtinPipelineFor(policy);
  return {
    source: "builtin",
    pipelines: BUILTIN_PIPELINES,
    projects,
    defaultPipeline: "default",
  };
}
