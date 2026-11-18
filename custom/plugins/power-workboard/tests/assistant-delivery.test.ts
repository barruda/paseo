import { expect, it } from "vitest";
import {
  dependencyRefusal,
  newDependencyPaths,
} from "../server/assistant/delivery";

it("finds new dependency folders and symlinks in porcelain status lines", () => {
  expect(
    newDependencyPaths([
      "?? node_modules",
      "?? packages/app/node_modules/",
      "A  .venv",
      '?? "web/node_modules"',
      "?? tools/venv/bin/python",
    ]),
  ).toEqual([
    "node_modules",
    "packages/app/node_modules",
    ".venv",
    "web/node_modules",
    "tools/venv/bin/python",
  ]);
});

it("ignores tracked changes and look-alike names", () => {
  expect(
    newDependencyPaths([
      " M node_modules",
      " D packages/node_modules/x.js",
      "?? docs/node_modules.md",
      "?? src/venv-setup.ts",
      "?? notes.md",
    ]),
  ).toEqual([]);
});

it("the refusal names the paths, or is null when nothing would be committed", () => {
  expect(dependencyRefusal(["?? notes.md"])).toBeNull();
  const refusal = dependencyRefusal(
    Array.from({ length: 7 }, (_, i) => `?? p${i}/node_modules`),
  );
  expect(refusal).toContain("p0/node_modules, p1/node_modules");
  expect(refusal).toContain("and 2 more");
});
