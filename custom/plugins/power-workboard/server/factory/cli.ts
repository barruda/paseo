// CUSTOM(factory): `bin/factory`, the factory's command line. Not part of the plugin bundle.
//
//   factory validate [dir]   load and compile; print errors and warnings; exit 1 on any error
//   factory schema [dir]     write <dir>/.schema/*.json from the Zod schemas
//   factory export <dir> [--data <file>] [--profiles <dir>] [--projects <file>]
//                            write a new factory from the board's data and commit it (git init);
//                            the inputs default to the live files under $PASEO_HOME, which are
//                            only read
//   factory memory <dir> [--profiles <dir>]
//                            copy each profile's memory/ into <dir>/workers/<id>/memory and
//                            <dir>/pm/memory through .factory-ids.json (the cutover); never
//                            overwrites a file; the profiles default to $PASEO_HOME's, only read
//
// The directory of validate and schema defaults to $PASEO_HOME/factory (~/.paseo/factory). Export
// takes no default, and neither does memory: writing the live factory is the cutover, which the
// user approves.
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compileFactory } from "../../shared/factory/compile";
import { copyProfileMemory } from "./cutover";
import {
  exportFactory,
  formatIssue,
  IDS_FILE,
  readPaseoProjects,
  readWorkboardData,
} from "./export";
import { writeFactoryJsonSchemas } from "./json-schema";
import { loadFactory } from "./loader";

export type CliIo = {
  out: (line: string) => void;
  err: (line: string) => void;
  env: Record<string, string | undefined>;
  cwd: string;
};

const USAGE =
  "usage: factory validate [dir] | factory schema [dir] | factory export <dir> [--data <file>] [--profiles <dir>] [--projects <file>] | factory memory <dir> [--profiles <dir>]";

const paseoHome = (env: CliIo["env"]) =>
  env.PASEO_HOME || path.join(homedir(), ".paseo");

export function defaultFactoryRoot(env: CliIo["env"]): string {
  return path.join(paseoHome(env), "factory");
}

const EXPORT_FLAGS = ["--data", "--profiles", "--projects"] as const;

async function runExport(args: string[], io: CliIo): Promise<number> {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if ((EXPORT_FLAGS as readonly string[]).includes(arg)) {
      const value = args[++index];
      if (!value) {
        io.err(USAGE);
        return 2;
      }
      flags[arg] = path.resolve(io.cwd, value);
    } else if (arg.startsWith("-") || positional.length) {
      io.err(USAGE);
      return 2;
    } else positional.push(arg);
  }
  if (!positional[0]) {
    io.err(USAGE);
    return 2;
  }
  const home = paseoHome(io.env);
  const target = path.resolve(io.cwd, positional[0]);
  const dataFile =
    flags["--data"] ??
    path.join(
      home,
      "plugin-settings",
      "power-workboard",
      "workboard-data.json",
    );
  let result;
  try {
    result = await exportFactory({
      data: await readWorkboardData(dataFile),
      projects: await readPaseoProjects(
        flags["--projects"] ?? path.join(home, "projects", "projects.json"),
      ),
      profilesRoot:
        flags["--profiles"] ??
        path.join(home, "plugin-data", "power-workboard", "profiles"),
      target,
    });
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  for (const warning of result.warnings) io.err(`warning: ${warning}`);
  for (const issue of result.errors) io.err(`error: ${formatIssue(issue)}`);
  if (!result.commit) {
    io.err(`${target}: the exported factory is invalid; nothing was committed`);
    return 1;
  }
  for (const [uuid, slug] of Object.entries(result.ids.workers))
    io.out(`worker ${uuid} -> ${slug}`);
  io.out(
    `${target}: exported ${Object.keys(result.ids.workers).length} workers and ${Object.keys(result.ids.projects).length} projects (commit ${result.commit.slice(0, 12)}; ids in ${IDS_FILE})`,
  );
  return 0;
}

async function runMemory(args: string[], io: CliIo): Promise<number> {
  let profiles: string | null = null;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--profiles" && args[index + 1])
      profiles = path.resolve(io.cwd, args[++index]!);
    else if (arg.startsWith("-") || positional.length) {
      io.err(USAGE);
      return 2;
    } else positional.push(arg);
  }
  if (!positional[0]) {
    io.err(USAGE);
    return 2;
  }
  try {
    const copied = await copyProfileMemory({
      factoryRoot: path.resolve(io.cwd, positional[0]),
      profilesRoot:
        profiles ??
        path.join(
          paseoHome(io.env),
          "plugin-data",
          "power-workboard",
          "profiles",
        ),
    });
    for (const { from, to } of copied) io.out(`${from} -> ${to}`);
    io.out(`copied ${copied.length} memory folder(s)`);
    return 0;
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** Runs one command; returns the exit code. */
export async function runFactoryCli(
  args: string[],
  io: CliIo,
): Promise<number> {
  const [command, dir, ...rest] = args;
  if (command === "export") return runExport(args.slice(1), io);
  if (command === "memory") return runMemory(args.slice(1), io);
  if ((command !== "validate" && command !== "schema") || rest.length) {
    io.err(USAGE);
    return 2;
  }
  const root = path.resolve(io.cwd, dir ?? defaultFactoryRoot(io.env));
  if (command === "schema") {
    for (const file of await writeFactoryJsonSchemas(root)) io.out(file);
    return 0;
  }
  const loaded = await loadFactory(root);
  const warnings = [...loaded.warnings];
  const errors = [...loaded.errors];
  let summary = "";
  if (loaded.factory) {
    // No daemon here: every existing checkout counts as a Paseo project.
    const compiled = compileFactory(loaded.factory, {
      projectIdForPath: (realPath) => realPath,
    });
    errors.push(...compiled.errors);
    warnings.push(...compiled.warnings);
    if (compiled.compiled)
      summary = `${compiled.compiled.orchestrators.length} workers, ${compiled.compiled.projects.length} projects`;
  }
  for (const issue of errors) io.err(`error: ${formatIssue(issue)}`);
  for (const issue of warnings) io.err(`warning: ${formatIssue(issue)}`);
  if (errors.length) {
    io.err(`${root}: ${errors.length} error(s)`);
    return 1;
  }
  io.out(`${root}: valid (${summary})`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  runFactoryCli(process.argv.slice(2), {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    env: process.env,
    cwd: process.env.FACTORY_CWD || process.cwd(),
  }).then((code) => process.exit(code));
