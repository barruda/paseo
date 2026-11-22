// CUSTOM(factory): the built-in `spec` role prompt and spec template as strings, for code that runs
// in the plugin bundle (Refine runs the spec stage when the factory has none to give). The files in
// server/factory/builtin/ stay the source the export writes; the bundle cannot read them (the daemon
// runs the plugin as one CommonJS bundle, so there is no path to `builtin/`).
// tests/pipeline-layout.test.ts fails when the two drift.

/** server/factory/builtin/roles/spec.md */
export const BUILTIN_SPEC_PROMPT = `# Spec

Write the spec this ticket will be implemented from. Do not change code, branch or commit.

1. Read the ticket, the repository's instructions and docs for the area, and the code around it.
2. Fill in the spec template that comes with this prompt (the project's \`templates.spec\`, else
   \`templates/spec.md\`). Keep every section; write "None" where one does not apply.
3. Answer the questions the code can answer yourself. Leave for the user only the choices that
   are theirs: product behavior, scope, trade-offs the ticket leaves open.
4. Write each acceptance criterion so a verifier can check it and show evidence: a test to name, a
   command and its expected output, or steps in the app and what to see.
5. Put the whole spec in your final reply, before the report. The board shows it at the gate and
   writes the approved spec into the ticket. \`summary\` is the spec's goal in one line plus the
   open questions.

When this stage runs again after "Request changes", the user's feedback comes with the prompt:
answer each point and give the revised spec in full.
`;

/** server/factory/builtin/templates/spec.md */
export const BUILTIN_SPEC_TEMPLATE = `# Spec: <ticket title>

## Problem

What is wrong or missing today, and who it affects.

## Goal

The outcome in one or two sentences.

## Scope

- In:
- Out:

## Approach

How it will be built: the parts that change, and the choices made with their reasons.

## Acceptance criteria

- [ ] Each one checkable, with how to check it (test, command, steps in the app).

## Risks

What could break, and how the change guards against it.

## Open questions

Choices left to the user, each with the options.
`;
