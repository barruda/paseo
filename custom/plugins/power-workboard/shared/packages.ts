// CUSTOM(packages): pure package logic shared by the board, the gate engine, the PM tools and the
// client. No I/O here, so the tier rule, the progress counts and the bisect are unit-tested.
import type {
  Data,
  Finish,
  GroupColor,
  Package,
  PackageRun,
  PackageView,
  Task,
  TestTier,
} from "./model";
import { GROUP_COLORS } from "./model";
import type { ProjectPolicy } from "./assistant";
import { projectPolicySchema } from "./assistant";

export interface ResolvedGate {
  command: string;
  requiredEnv: string[];
  env: Record<string, string>;
  setupCommand: string;
  runIn: "worktree" | "checkout";
}

/** A package's gate: its own override, else the project's tests policy, else the verify command. */
export function resolvePackageGate(
  pkg: Package | null | undefined,
  policy: ProjectPolicy,
): ResolvedGate {
  const tests = policy.tests;
  const gate = pkg?.gate ?? null;
  return {
    command:
      gate?.command.trim() ||
      tests.gateCommand.trim() ||
      policy.verifyCommand.trim(),
    requiredEnv: gate?.requiredEnv.length
      ? gate.requiredEnv
      : tests.gateRequiredEnv,
    env: { ...tests.gateEnv, ...(gate?.env ?? {}) },
    setupCommand: gate?.setupCommand.trim() || tests.gateSetupCommand.trim(),
    runIn: gate?.runIn ?? tests.gateRunIn,
  };
}

/** The required variables missing from the run's environment; a missing one fails the gate. */
export function missingGateEnv(
  gate: Pick<ResolvedGate, "requiredEnv" | "env">,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return gate.requiredEnv.filter((name) => !(gate.env[name] ?? env[name]));
}

/** The level a ticket runs at: no package is full (today's behavior); a package is restricted
 * unless the ticket carries an override (the risk rule or the PM). */
export function effectiveTestTier(
  task: Pick<Task, "packageId" | "testTier">,
): TestTier {
  if (!task.packageId) return "full";
  return task.testTier?.tier ?? "restricted";
}

export interface PackageProgress {
  total: number;
  merged: number;
  canceled: number;
}

/** Delivered means merged in the base, or committed in place (folder mode never merges). */
export function isDelivered(
  task: Task,
  finish: Finish | undefined,
  inPlace = false,
): boolean {
  if (!finish) return false;
  return finish.mergedAt !== null || (inPlace && finish.committedAt !== null);
}

export function packageProgress(
  tasks: readonly Task[],
  finishes: Readonly<Record<string, Finish>>,
  groups: Data["settings"]["groups"],
  inPlace: ReadonlySet<string> = new Set(),
): PackageProgress {
  let merged = 0;
  let canceled = 0;
  for (const task of tasks) {
    if (isDelivered(task, finishes[task.id], inPlace.has(task.id))) merged += 1;
    const kind = groups.find((group) => group.id === task.lastStage)?.kind;
    if (kind === "canceled") canceled += 1;
  }
  return { total: tasks.length, merged, canceled };
}

/** A new package takes the least used color, like the columns do. */
export function nextPackageColor(packages: readonly Package[]): GroupColor {
  const counts = new Map<GroupColor, number>(
    GROUP_COLORS.map((color) => [color, 0]),
  );
  for (const pkg of packages) {
    const color = pkg.color ?? "gray";
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return GROUP_COLORS.reduce((least, color) =>
    (counts.get(color) ?? 0) < (counts.get(least) ?? 0) ? color : least,
  );
}

export function lastRunOf(
  runs: readonly PackageRun[],
  packageId: string,
): PackageRun | null {
  return (
    runs
      .filter((run) => run.packageId === packageId)
      .sort((left, right) =>
        right.startedAt.localeCompare(left.startedAt),
      )[0] ?? null
  );
}

/** The snapshot's per-package view: counts and the last run, never the whole history. */
export function packageViews(
  data: Data,
  projects: readonly { id: string; name: string }[],
): PackageView[] {
  const names = new Map(projects.map((project) => [project.id, project.name]));
  return [...data.packages]
    .sort(
      (left, right) =>
        (left.status === right.status ? 0 : left.status === "open" ? -1 : 1) ||
        right.createdAt.localeCompare(left.createdAt),
    )
    .map((pkg) => {
      const tasks = data.tasks.filter((task) => task.packageId === pkg.id);
      const progress = packageProgress(
        tasks,
        data.finishes,
        data.settings.groups,
        new Set(
          Object.entries(data.orchestrations)
            .filter(([, run]) => run.inPlace)
            .map(([id]) => id),
        ),
      );
      const lastRun = lastRunOf(data.packageRuns, pkg.id);
      const policy =
        data.assistant.settings.projects[pkg.projectId] ??
        projectPolicySchema.parse({
          action: data.assistant.settings.defaultAction,
        });
      return {
        id: pkg.id,
        name: pkg.name,
        projectId: pkg.projectId,
        projectName: names.get(pkg.projectId) ?? "",
        color: pkg.color ?? "gray",
        status: pkg.status,
        branch: pkg.branch,
        trigger: pkg.trigger,
        tierPolicy: pkg.tierPolicy,
        gate: (() => {
          const resolved = resolvePackageGate(pkg, policy);
          return {
            command: resolved.command,
            requiredEnv: resolved.requiredEnv,
            setupCommand: resolved.setupCommand,
            runIn: resolved.runIn,
          };
        })(),
        createdAt: pkg.createdAt,
        closedAt: pkg.closedAt,
        ...progress,
        lastRun: lastRun
          ? { ...lastRun, output: lastRun.output.slice(0, 500) }
          : null,
        suspectTaskIds:
          lastRun?.status === "failed" && lastRun.suspectTaskId
            ? [lastRun.suspectTaskId]
            : [],
      };
    });
}

/** The package's tickets in merge order: merged ones first, oldest merge first. */
export function packageTaskOrder(
  tasks: readonly Task[],
  finishes: Readonly<Record<string, Finish>>,
  packageId: string,
): Task[] {
  return tasks
    .filter((task) => task.packageId === packageId)
    .sort((left, right) => {
      const leftAt = finishes[left.id]?.mergedAt ?? null;
      const rightAt = finishes[right.id]?.mergedAt ?? null;
      if (leftAt && rightAt) return leftAt.localeCompare(rightAt);
      if (leftAt) return -1;
      if (rightAt) return 1;
      return left.number - right.number;
    });
}

/**
 * Glob to RegExp: a double star followed by a slash matches zero or more folders, so a
 * migrations glob also matches a `migrations/` at the repository root. A bare double star
 * crosses folders; a single star and `?` stay inside one segment.
 */
export function riskGlobToRegExp(glob: string): RegExp {
  const value = glob.trim();
  const escape = (char: string) =>
    /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  let source = "";
  for (let index = 0; index < value.length; ) {
    if (value.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 3;
    } else if (value.startsWith("**", index)) {
      source += ".*";
      index += 2;
    } else if (value[index] === "*") {
      source += "[^/]*";
      index += 1;
    } else if (value[index] === "?") {
      source += "[^/]";
      index += 1;
    } else {
      source += escape(value[index]!);
      index += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesRiskPath(path: string, glob: string): boolean {
  return riskGlobToRegExp(glob).test(path.replace(/^\.\//, ""));
}

/** The changed paths a project's risk rule escalates, in diff order. */
export function riskyPaths(
  paths: readonly string[],
  globs: readonly string[],
): string[] {
  if (!globs.length) return [];
  return paths.filter((path) =>
    globs.some((glob) => matchesRiskPath(path, glob)),
  );
}

/**
 * The first failing item, assuming a monotonic history (everything before it passes). The last
 * item must fail; null means the search found no failure. Each item costs one gate run.
 */
export async function findFirstFailing<T>(
  items: readonly T[],
  passes: (item: T, index: number) => Promise<boolean>,
): Promise<number | null> {
  let low = 0;
  let high = items.length - 1;
  let found: number | null = null;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const ok = await passes(items[mid]!, mid);
    if (ok) low = mid + 1;
    else {
      found = mid;
      high = mid - 1;
    }
  }
  return found;
}

/** The merge target of a package's tickets: its branch, else the project's base. */
export function packageMergeTarget(
  pkg: Package | null | undefined,
  policy: ProjectPolicy,
): string | null {
  return pkg?.branch?.trim() || policy.baseBranch.trim() || null;
}

/**
 * The gate run that covered one merge: the first run that started after the merge. A gate runs at
 * the package's integration tip, so a run started after a merge includes it. Null means the gate
 * has not run since that merge.
 */
export function gateRunForMerge(
  mergedAt: string | null,
  runs: readonly PackageRun[],
): PackageRun | null {
  if (!mergedAt) return null;
  const after = runs
    .filter((run) => run.startedAt.localeCompare(mergedAt) >= 0)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  return after[0] ?? null;
}

/** The prompt section for a ticket in a package; empty for a ticket without one. */
export function testSectionFor(
  task: Pick<Task, "packageId" | "testTier">,
  policy: ProjectPolicy,
  packageName: string,
  pkg: Package | null = null,
): string {
  if (!task.packageId) return "";
  const gate = resolvePackageGate(pkg, policy);
  const tier = effectiveTestTier(task);
  const verify = policy.verifyCommand.trim();
  const verifyLine = verify
    ? `The project's verify command (\`${verify}\`) runs automatically before the merge; don't repeat it.`
    : "";
  if (tier === "gate") {
    return [
      "## Tests — gate",
      `This ticket belongs to the package "${packageName}". Run only the suites for the area you changed, chosen from the repo's test map (for example AGENTS.md). ${verifyLine}`,
      gate.command
        ? `The package gate (\`${gate.command}\`) runs automatically after your turn in this workspace; do not run it or the full suite yourself.`
        : "The package gate runs after your turn; do not run the full suite yourself.",
      "This section replaces any test instruction above.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "## Tests — restricted",
    `This ticket belongs to the package "${packageName}". Run only the suites for the area you changed, chosen from the repo's test map (for example AGENTS.md). ${verifyLine}`,
    "Do not run the full suite: the package gate runs it once for the whole package, outside this ticket. This section replaces any test instruction above.",
  ]
    .filter(Boolean)
    .join("\n");
}
