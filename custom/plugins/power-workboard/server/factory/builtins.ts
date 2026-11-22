// CUSTOM(factory): the files `bin/factory export` adds to every new factory: the built-in pipelines,
// the role prompts, a README and the .gitignore (docs/factory.md, "pipelines/<id>.yaml" and
// "Migration"). Ticket 6 gives the pipelines a schema; until then the loader checks file names only.

/** `default`: today's flow. The worker implements, the Project Manager reviews and delivers. */
const DEFAULT_PIPELINE = `description: Today's flow. The worker implements, the Project Manager reviews and delivers.
start: implement
stages:
  implement:
    role: implement
    to: review
  review:
    role: pm # the Project Manager reviews the diff itself (review policy "self")
    to: deliver
`;

/** `critical`: replaces the review policy `fresh-agent`. */
const CRITICAL_PIPELINE = `description: Critical projects. Spec approved by the user, verified with evidence, reviewed by a fresh agent.
start: triage
stages:
  triage:
    role: triage
    to:
      - stage: spec
        when: The ticket is large, ambiguous, or changes visible behavior.
      - stage: implement
        when: The ticket is small and clear.
  spec:
    role: spec
    gate:
      question: Approve this spec?
      options:
        - { id: approve, label: Approve, to: implement }
        - { id: changes, label: Request changes, to: spec }
  implement:
    role: implement
    to: verify
  verify:
    role: verify
    to:
      - stage: review
        when: Every check passed, with evidence.
      - stage: implement
        when: A check failed.
  review:
    role: review
    session: fresh # a new agent, never the author
    to:
      - stage: deliver
        when: No blocking findings.
      - stage: implement
        when: Blocking findings remain.
`;

export const BUILTIN_PIPELINES: Readonly<Record<string, string>> = {
  default: DEFAULT_PIPELINE,
  critical: CRITICAL_PIPELINE,
};

/** roles/<role>.md: the default procedure of a stage with that role. */
export const BUILTIN_ROLES: Readonly<Record<string, string>> = {
  triage: `# Triage

Read the ticket and the code it touches. Do not change anything.

Decide whether the ticket is small and clear (one obvious change, nothing visible to the user
changes in a way the ticket leaves open) or needs a spec first (large, ambiguous, or it changes
visible behavior). Say which and why in two or three sentences, naming the files involved.
`,
  spec: `# Spec

Write the spec for this ticket. Do not implement it.

Read the code the ticket touches first. Follow the project's spec template when it has one. The spec
says what changes and what stays, the decisions with their reasons, the acceptance criteria one by
one, and how each is verified. List the questions only the user can answer; never guess them.
`,
  implement: `# Implement

Implement the ticket in this workspace. Follow the repository's own instructions and the patterns
already in the code. Stay in the ticket's scope: what you find outside it goes in the report as a
follow-up. Run the checks the project asks for and report each with its real result.
`,
  verify: `# Verify

Check the work against each acceptance criterion of the ticket, with evidence. Do not fix anything.

For each criterion, run what proves it (a test, a command, a screenshot) and record the command and
what it showed. A criterion you could not check is unverified, never passed. End with the list of
criteria and their results.
`,
  review: `# Review

Review the diff of this task as a reviewer who did not write it. Read the ticket, then the diff
against the base branch, then the code around it.

Report blocking findings first (wrong behavior, a missed acceptance criterion, data loss, security),
then minor ones. Each finding names the file and line and the scenario that breaks. No findings is
a valid result: say so.
`,
};

export const FACTORY_GITIGNORE = `# Written by the agents, not part of the config.
workers/*/memory/
pm/memory/
# bin/factory export: worker UUID -> slug map, read once at the cutover (docs/factory.md, Migration).
.factory-ids.json
`;

export const FACTORY_README = `# Power Workboard factory

The board's configuration: workers, projects, pipelines and role prompts. The files are the source of
truth; see \`custom/plugins/power-workboard/docs/factory.md\` in the Paseo checkout for the layout.

Check it with \`bin/factory validate <this folder>\` and refresh editor completion with
\`bin/factory schema <this folder>\`.
`;
