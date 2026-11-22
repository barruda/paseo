// CUSTOM(factory): the files every factory starts with, kept in `builtin/` with the factory's own
// layout: the `default` and `critical` pipelines, the role prompts, the spec template and the
// README, plus the .gitignore below. `bin/factory export` (export.ts) writes them into a new
// factory. Not part of the plugin bundle.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A function, not a module-level constant: shadow.ts imports export.ts, which imports this file,
 * into the plugin bundle, where the daemon evaluates CJS and `import.meta.url` is undefined, so
 * `new URL` at import time threw "Invalid URL" and the plugin failed to load.
 */
export function builtinFactoryDir(): string {
  return fileURLToPath(new URL("./builtin/", import.meta.url));
}

/** A constant, not a file in `builtin/`: a real .gitignore there would apply to this repository. */
export const FACTORY_GITIGNORE = `# Written by the agents, not part of the config.
workers/*/memory/
pm/memory/
# The Claude plugin manifest active mode writes next to each worker.md.
.claude-plugin/
# bin/factory export: worker UUID -> slug map, read once at the cutover (docs/factory.md, Migration).
.factory-ids.json
`;

/** Relative path (with `/`) → content of every file under `builtin/`, plus `.gitignore`. */
export async function readBuiltinFactoryFiles(): Promise<
  Record<string, string>
> {
  const files: Record<string, string> = { ".gitignore": FACTORY_GITIGNORE };
  const dir = builtinFactoryDir();
  const entries = await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const relative = path.relative(dir, full).split(path.sep).join("/");
    files[relative] = await readFile(full, "utf8");
  }
  return Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
