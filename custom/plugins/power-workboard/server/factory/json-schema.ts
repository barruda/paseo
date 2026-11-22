// CUSTOM(factory): writes `.schema/*.json` from the factory's Zod schemas, so an editor with the YAML
// language server completes and checks the files (`# yaml-language-server: $schema=.schema/factory.json`).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { FACTORY_JSON_SCHEMAS } from "../../shared/factory/schema";

export function factoryJsonSchemas(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(FACTORY_JSON_SCHEMAS).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
    ]),
  );
}

/** Writes every schema to `<root>/.schema/`; returns the files written. */
export async function writeFactoryJsonSchemas(root: string): Promise<string[]> {
  const dir = path.join(root, ".schema");
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, schema] of Object.entries(factoryJsonSchemas())) {
    const file = path.join(dir, name);
    await writeFile(file, `${JSON.stringify(schema, null, 2)}\n`);
    written.push(file);
  }
  return written;
}
