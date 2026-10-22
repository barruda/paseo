// CUSTOM(changes-diff-tab): Changes file clicks reuse the open diff tab unless "Open in
// different tabs" is checked.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";
import { test, expect } from "../support/fixtures";
import { getServerId } from "../support/helpers/server-id";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";

const cleanups: (() => Promise<void>)[] = [];

test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function createDirtyWorkspace() {
  const repo = await createTempGitRepo("changes-diff-tab-", {
    files: [
      { path: "a.ts", content: "export const a = 1;\n" },
      { path: "b.ts", content: "export const b = 1;\n" },
    ],
  });
  const client = await connectSeedClient();
  cleanups.push(async () => {
    await client.close().catch(() => undefined);
    await repo.cleanup().catch(() => undefined);
  });
  await writeFile(path.join(repo.path, "a.ts"), "export const a = 2;\n");
  await writeFile(path.join(repo.path, "b.ts"), "export const b = 2;\n");
  const created = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
  });
  if (!created.workspace) throw new Error(created.error ?? "Failed to create workspace");
  return created.workspace.id;
}

async function openChangesTree(page: Page, workspaceId: string, tasksMode: boolean) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspaceId));
  await waitForWorkspaceTabsVisible(page);
  if (tasksMode) await page.getByTestId("task-navigation-switch").click();
  await page.getByTestId("workspace-explorer-toggle").filter({ visible: true }).first().click();
  const explorer = page.getByTestId("workspace-explorer-sidebar");
  await expect(explorer).toBeVisible({ timeout: 30_000 });
  await explorer
    .getByRole("button", { name: /Working tree diff/i })
    .first()
    .click();
  await expect(explorer.getByText("b.ts", { exact: true })).toBeVisible({ timeout: 30_000 });
  return explorer;
}

/** In Tasks mode the Explorer belongs to the focused Desk tab, so a diff tab taking focus hides it. */
async function showChanges(page: Page, explorer: Locator) {
  if (!(await explorer.isVisible())) {
    await page.getByTestId("workspace-explorer-toggle").filter({ visible: true }).first().click();
  }
  await explorer.getByTestId("workspace-tab-changes_tree").click();
}

async function expectDiffTabReuse(page: Page, tasksMode: boolean) {
  const workspaceId = await createDirtyWorkspace();
  const explorer = await openChangesTree(page, workspaceId, tasksMode);
  const diffTabs = page.getByTestId("workspace-tab-working_diff").filter({ visible: true });
  const tree = explorer.getByTestId("changes-file-tree");
  const toggle = explorer.getByTestId("changes-open-in-new-tabs");
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await tree.getByText("a.ts", { exact: true }).click();
  await expect(diffTabs).toHaveCount(1);
  if (!tasksMode) {
    // Focus a file tab, so the next click cannot just replace the focused diff preview.
    await explorer.getByTestId("workspace-tab-files").click();
    await explorer
      .getByTestId("file-explorer-tree-scroll")
      .getByText("a.ts", { exact: true })
      .click();
    await expect(page.getByTestId("workspace-tab-file_a.ts")).toBeVisible();
  }
  await showChanges(page, explorer);
  await tree.getByText("b.ts", { exact: true }).click();
  await expect(diffTabs).toHaveCount(1);
  await expect(diffTabs).toHaveAttribute("aria-selected", "true");

  await showChanges(page, explorer);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await tree.getByText("a.ts", { exact: true }).click();
  await expect(diffTabs).toHaveCount(2);
}

test("Changes file clicks reuse the open diff tab until Open in different tabs is checked", async ({
  page,
}) => {
  await expectDiffTabReuse(page, false);
});

test("in Tasks mode, Changes file clicks reuse the Desk's diff tab", async ({ page }) => {
  await expectDiffTabReuse(page, true);
});
