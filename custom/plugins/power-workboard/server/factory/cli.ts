// CUSTOM(factory): `bin/factory`, the factory's command line. Not part of the plugin bundle.
//
//   factory validate [dir]   load and compile; print errors and warnings; exit 1 on any error
//   factory schema [dir]     write <dir>/.schema/*.json from the Zod schemas
//
// The directory defaults to $PASEO_HOME/factory (~/.paseo/factory).
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compileFactory } from "../../shared/factory/compile";
import type { FactoryIssue } from "../../shared/factory/schema";
import { writeFactoryJsonSchemas } from "./json-schema";
import { loadFactory } from "./loader";

export type CliIo = {
  out: (line: string) => void;
  err: (line: string) => void;
  env: Record<string, string | undefined>;
  cwd: string;
};

const USAGE = "usage: factory validate [dir] | factory schema [dir]";

const format = (issue: FactoryIssue) =>
  `${issue.file}${issue.line ? `:${issue.line}` : ""}: ${issue.message} [${issue.kind}]`;

export function defaultFactoryRoot(env: CliIo["env"]): string {
  return path.join(env.PASEO_HOME || path.join(homedir(), ".paseo"), "factory");
}

/** Runs one command; returns the exit code. */
export async function runFactoryCli(
  args: string[],
  io: CliIo,
): Promise<number> {
  const [command, dir, ...rest] = args;
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
  for (const issue of errors) io.err(`error: ${format(issue)}`);
  for (const issue of warnings) io.err(`warning: ${format(issue)}`);
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
