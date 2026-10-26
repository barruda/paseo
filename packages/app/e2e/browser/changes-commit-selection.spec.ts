// CUSTOM(commit-selection): pick files in the Changes tree, commit only them, discard them.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
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
  const repo = await createTempGitRepo("commit-selection-", {
    files: [
      { path: "src/components/a.ts", content: "export const a = 1;\n" },
      { path: "src/components/b.ts", content: "export const b = 1;\n" },
      { path: "README.md", content: "readme\n" },
    ],
  });
  const client = await connectSeedClient();
  cleanups.push(async () => {
    await client.close().catch(() => undefined);
    await repo.cleanup().catch(() => undefined);
  });
  await writeFile(path.join(repo.path, "src/components/a.ts"), "export const a = 2;\n");
  await writeFile(path.join(repo.path, "src/components/b.ts"), "export const b = 2;\n");
  await writeFile(path.join(repo.path, "README.md"), "readme changed\n");
  await writeFile(path.join(repo.path, "notes.txt"), "new file\n");
  const created = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
  });
  if (!created.workspace) throw new Error(created.error ?? "Failed to create workspace");
  return { id: created.workspace.id, repoPath: repo.path };
}

async function openChangesTree(page: Page, workspaceId: string) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspaceId));
  await waitForWorkspaceTabsVisible(page);
  await page.getByTestId("workspace-explorer-toggle").first().click();
  const explorer = page.getByTestId("workspace-explorer-sidebar");
  await expect(explorer).toBeVisible({ timeout: 30_000 });
  await explorer
    .getByRole("button", { name: /Working tree diff/i })
    .first()
    .click();
  const tree = explorer.getByTestId("changes-file-tree");
  await expect(tree.getByText("notes.txt", { exact: true })).toBeVisible({ timeout: 30_000 });
  return explorer;
}

function fileCheck(explorer: ReturnType<Page["getByTestId"]>, name: string) {
  return explorer
    .locator('[data-testid^="diff-tree-file-"]')
    .filter({ has: explorer.page().getByText(name, { exact: true }) })
    .getByRole("checkbox");
}

function git(repoPath: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoPath }).toString();
}

test("Changes commits only the checked files and discards the checked files", async ({ page }) => {
  const workspace = await createDirtyWorkspace();
  const explorer = await openChangesTree(page, workspace.id);
  const commitButton = explorer.getByTestId("commit-selected");
  const folderCheck = explorer.getByTestId("diff-folder-src/components-commit-check");

  // Nothing starts checked; a folder checks the files under it.
  await expect(commitButton).toHaveText("Commit");
  await expect(folderCheck).toHaveAttribute("aria-checked", "false");
  await folderCheck.click();
  await expect(folderCheck).toHaveAttribute("aria-checked", "true");
  await expect(fileCheck(explorer, "a.ts")).toHaveAttribute("aria-checked", "true");
  await expect(fileCheck(explorer, "b.ts")).toHaveAttribute("aria-checked", "true");
  await expect(commitButton).toHaveText("Commit 2 files");
  await fileCheck(explorer, "b.ts").click();
  await expect(folderCheck).toHaveAttribute("aria-checked", "mixed");
  await expect(commitButton).toHaveText("Commit 1 file");
  // Checking a file does not open its diff.
  await expect(page.getByTestId("working-diff-panel")).toHaveCount(0);

  await explorer.getByTestId("commit-select-all").click();
  await expect(commitButton).toHaveText("Commit 4 files");
  await explorer.getByTestId("commit-select-none").click();
  await expect(commitButton).toHaveText("Commit");

  // Commit a.ts and the new notes.txt only.
  await fileCheck(explorer, "a.ts").click();
  await fileCheck(explorer, "notes.txt").click();
  await expect(commitButton).toBeDisabled();
  await explorer.getByTestId("commit-message-input").fill("Pick two files");
  await commitButton.click();
  await expect
    .poll(() => git(workspace.repoPath, ["log", "-1", "--format=%s"]).trim(), { timeout: 30_000 })
    .toBe("Pick two files");
  expect(git(workspace.repoPath, ["show", "--name-only", "--format=", "HEAD"]).trim()).toBe(
    "notes.txt\nsrc/components/a.ts",
  );
  await expect(explorer.getByText("notes.txt", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(commitButton).toHaveText("Commit");
  await expect(explorer.getByTestId("commit-message-input")).toHaveValue("");

  // Discard asks first; dismissing keeps the change.
  await fileCheck(explorer, "README.md").click();
  page.once("dialog", (dialog) => void dialog.dismiss());
  await explorer.getByTestId("commit-discard-selected").click();
  await expect(fileCheck(explorer, "README.md")).toHaveAttribute("aria-checked", "true");
  expect(await readFile(path.join(workspace.repoPath, "README.md"), "utf8")).toBe(
    "readme changed\n",
  );
  const confirmation = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      resolve(dialog.message());
      await dialog.accept();
    });
  });
  await explorer.getByTestId("commit-discard-selected").click();
  expect(await confirmation).toContain("1 file");
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "README.md"), "utf8"), { timeout: 30_000 })
    .toBe("readme\n");
  await expect(explorer.getByText("README.md", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  expect(git(workspace.repoPath, ["status", "--porcelain"])).toBe(" M src/components/b.ts\n");
});

test("Ctrl+E focuses the commit message and Ctrl+Enter with nothing checked offers to select all", async ({
  page,
}) => {
  const workspace = await createDirtyWorkspace();
  const explorer = await openChangesTree(page, workspace.id);
  const input = explorer.getByTestId("commit-message-input");

  // Ctrl+E toggles the Explorer; opening it focuses the commit message.
  await page.keyboard.press("ControlOrMeta+e");
  await expect(explorer).toBeHidden();
  await page.keyboard.press("ControlOrMeta+e");
  await expect(input).toBeFocused({ timeout: 10_000 });

  await input.fill("Everything");
  const prompt = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      resolve(dialog.message());
      await dialog.accept();
    });
  });
  await input.press("ControlOrMeta+Enter");
  expect(await prompt).toContain("Nothing is selected");
  await expect
    .poll(() => git(workspace.repoPath, ["log", "-1", "--format=%s"]).trim(), { timeout: 30_000 })
    .toBe("Everything");
  expect(git(workspace.repoPath, ["status", "--porcelain"])).toBe("");
});
