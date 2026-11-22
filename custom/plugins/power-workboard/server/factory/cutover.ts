// CUSTOM(factory): the cutover's memory step (docs/factory.md, "Cutover"). Active mode reads a
// worker's memory from `workers/<id>/memory/` and the Project Manager's from `pm/memory/`; this
// copies the profile folders' memory there through `.factory-ids.json`. It never overwrites a file
// and leaves the profile folders as they are, so going back to shadow or off loses nothing. Not
// part of the plugin bundle.
import { cp, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ASSISTANT_PROFILE } from "../../shared/profiles";
import { IDS_FILE } from "./export";

const idsSchema = z.object({
  workers: z.record(z.string(), z.string()).default({}),
});

export type MemoryCopy = { from: string; to: string };

const isDirectory = (dir: string) =>
  stat(dir).then(
    (entry) => entry.isDirectory(),
    () => false,
  );

/** Copies each profile's `memory/` into the factory; returns what it copied. */
export async function copyProfileMemory(options: {
  factoryRoot: string;
  profilesRoot: string;
}): Promise<MemoryCopy[]> {
  const { factoryRoot, profilesRoot } = options;
  let text: string;
  try {
    text = await readFile(path.join(factoryRoot, IDS_FILE), "utf8");
  } catch {
    throw new Error(
      `${path.join(factoryRoot, IDS_FILE)} is missing; run factory export first`,
    );
  }
  const ids = idsSchema.parse(JSON.parse(text));
  const pairs: Array<[string, string]> = [
    ...Object.entries(ids.workers).map(
      ([live, slug]) =>
        [
          path.join(profilesRoot, live, "memory"),
          path.join(factoryRoot, "workers", slug),
        ] as [string, string],
    ),
    [
      path.join(profilesRoot, ASSISTANT_PROFILE, "memory"),
      path.join(factoryRoot, "pm"),
    ],
  ];
  const copied: MemoryCopy[] = [];
  for (const [from, folder] of pairs) {
    // A worker the export left out (inactive project) has no folder to copy into.
    if (!(await isDirectory(from)) || !(await isDirectory(folder))) continue;
    const to = path.join(folder, "memory");
    await cp(from, to, { recursive: true, force: false, errorOnExist: false });
    copied.push({ from, to });
  }
  return copied;
}
