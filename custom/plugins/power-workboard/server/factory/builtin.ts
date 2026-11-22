// CUSTOM(factory): the files every factory starts with, kept in `builtin/` with the factory's own
// layout: the `default` and `critical` pipelines, the role prompts and the spec template. The
// export (docs/factory.md, ticket 4) writes them into a new factory. Not part of the plugin bundle.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUILTIN_FACTORY_DIR = fileURLToPath(
  new URL("./builtin/", import.meta.url),
);

/** Relative path (with `/`) → content of every file under `builtin/`. */
export async function readBuiltinFactoryFiles(): Promise<
  Record<string, string>
> {
  const files: Record<string, string> = {};
  const entries = await readdir(BUILTIN_FACTORY_DIR, {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const relative = path
      .relative(BUILTIN_FACTORY_DIR, full)
      .split(path.sep)
      .join("/");
    files[relative] = await readFile(full, "utf8");
  }
  return Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  );
}
