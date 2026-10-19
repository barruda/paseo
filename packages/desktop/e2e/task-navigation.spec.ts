import { test, expect } from "../../app/e2e/support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../../app/e2e/support/helpers/mock-agent";
import { openCommandCenter } from "../../app/e2e/support/helpers/command-center";
import { getServerId } from "../../app/e2e/support/helpers/server-id";
import { installDesktopRuntime } from "./support/runtime";

test("Desks preview and pin across projects, restore tab sets, filter, and preserve workspace fallback", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await installDesktopRuntime(page, {
    serverId: getServerId(),
    manageBuiltInDaemon: false,
    platform: "linux",
  });
  const first = await seedMockAgentWorkspace({
    repoPrefix: "task-nav-first-",
    title: "Investigate sidebar navigation",
  });
  const second = await seedMockAgentWorkspace({
    repoPrefix: "task-nav-second-",
    title: "Review terrain changes",
    initialPrompt: "Finish this turn.",
  });
  try {
    await second.client.waitForFinish(second.agentId, 20_000);
    await openAgentRoute(page, first);
    await expect(page.getByTestId("sidebar-sessions")).toBeVisible();
    await expect(page.getByTestId("sidebar-search")).toBeVisible();
    await expect(page.getByTestId("sidebar-voice")).toBeVisible();
    await expect(page.getByTestId("sidebar-wake-dictation")).toBeVisible();
    await expect(page.getByTestId("sidebar-schedules")).toHaveCount(0);
    const more = page.getByTestId("sidebar-nav-show-more");
    await expect(more).toHaveText("Show more");
    await more.click();
    await expect(page.getByTestId("sidebar-schedules")).toBeVisible();
    await expect(more).toHaveText("Show less");
    await more.click();
    await expect(page.getByTestId("sidebar-schedules")).toHaveCount(0);
    const toggle = page.getByTestId("task-navigation-switch").filter({ visible: true });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    const sidebar = page.getByTestId("task-navigation-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByTestId(`task-agent-${first.agentId}`)).toBeVisible();
    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).toBeVisible();
    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).toContainText(
      "Ready to review",
    );

    await sidebar.getByTestId("task-navigation-search").fill("terrain");
    await expect(sidebar.getByTestId(`task-agent-${first.agentId}`)).toHaveCount(0);
    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).toBeVisible();
    await sidebar.getByRole("button", { name: "Clear task search" }).click();
    await sidebar.getByTestId("task-filter-review").click();
    await expect(sidebar.getByTestId(`task-agent-${first.agentId}`)).toHaveCount(0);
    await sidebar.getByTestId(`task-agent-${second.agentId}`).click();
    // Desks render the standard workspace tab row; the chip says whether it is the preview.
    const desk = page.getByTestId("desk-screen");
    const previewTab = desk.locator('[data-desk-tab="preview"]');
    const pinnedTabs = desk.locator('[data-desk-tab="pinned"]');
    const agentTabs = desk.locator('[data-testid^="workspace-tab-agent_"]');
    // Previewing another project keeps the Desk and its route stable.
    await expect(page).toHaveURL(new RegExp(`/workspace/${first.workspaceId}`));
    await expect(previewTab).toContainText("Review terrain");
    await expect(sidebar.getByTestId("task-filter-review")).toHaveText("Ready to review 0");
    await sidebar.getByTestId("task-filter-all").click();
    await expect(
      sidebar.getByTestId(`task-agent-${second.agentId}`).getByTestId("task-project-icon"),
    ).toBeVisible();

    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).not.toContainText(
      "Ready to review",
    );

    const composer = page
      .getByRole("textbox", { name: "Message agent...", exact: true })
      .filter({ visible: true });
    // Both the footer and Ctrl+J toggle a tabbed bottom pane of the Desk; its first terminal
    // belongs to the selected task's workspace.
    const bottom = desk.getByTestId("workspace-pane-bottom-panel");
    const countTerminals = async () =>
      (
        await second.client.listTerminals(second.cwd, undefined, {
          workspaceId: second.workspaceId,
        })
      ).terminals.length;
    await page.getByTestId("sidebar-bottom-panel-toggle").click();
    await expect(bottom).toBeVisible();
    await expect(bottom.locator('[data-testid^="workspace-tab-terminal_"]')).toHaveCount(1);
    await expect.poll(countTerminals).toBe(1);
    await page.keyboard.press("Control+j");
    await expect(bottom).not.toBeVisible();
    await page.keyboard.press("Control+j");
    await expect(bottom).toBeVisible();
    await expect.poll(countTerminals).toBe(1);
    await page.getByTestId("sidebar-bottom-panel-toggle").click();
    await expect(bottom).not.toBeVisible();
    // Closing the panel's last tab removes the pane, like in a workspace.
    await page.keyboard.press("Control+j");
    const terminalTab = bottom.locator('[data-testid^="workspace-tab-terminal_"]');
    const terminalId = (await terminalTab.getAttribute("data-testid"))!.replace(
      "workspace-tab-terminal_",
      "",
    );
    await terminalTab.hover();
    await bottom.getByTestId(`workspace-terminal-close-${terminalId}`).click();
    await expect(bottom).toHaveCount(0);

    await composer.fill("Draft for terrain");
    await sidebar.getByTestId(`task-agent-${first.agentId}`).click();
    await expect(composer).toHaveValue("");
    await sidebar.getByTestId(`task-agent-${second.agentId}`).click();
    await expect(composer).toHaveValue("Draft for terrain");
    await composer.fill("");
    await previewTab.click({ button: "middle" });
    await expect(previewTab).toHaveCount(0);
    await expect(agentTabs).toHaveCount(0);
    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).toBeVisible();
    await sidebar.getByTestId(`task-agent-${second.agentId}`).click({ button: "middle" });
    await expect(pinnedTabs).toHaveCount(1);
    await sidebar.getByTestId(`task-agent-${first.agentId}`).click();
    await expect(previewTab).toContainText("Investigate sidebar");
    await expect(pinnedTabs).toContainText("Review terrain");
    await page.getByTestId("desk-keep-preview").click();
    await expect(pinnedTabs).toHaveCount(2);
    await expect(previewTab).toHaveCount(0);

    // The workspace tab menu, with the customized actions, works on Desk tabs.
    await desk.getByTestId(`workspace-tab-agent_${second.agentId}`).click({ button: "right" });
    await expect(
      page.locator('[data-testid^="workspace-tab-context-"][data-testid$="-copy-agent-id"]'),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Desks split like workspaces; closing a split's only tab removes the split.
    const panes = desk.locator('[data-testid^="workspace-pane-"]');
    await expect(panes).toHaveCount(1);
    await desk.getByTestId("workspace-split-pane-right").click();
    await expect(panes).toHaveCount(2);
    await expect(pinnedTabs).toHaveCount(3);
    await panes.nth(1).locator("[data-desk-tab]").click({ button: "middle" });
    await expect(panes).toHaveCount(1);
    await expect(pinnedTabs).toHaveCount(2);

    await page.keyboard.press("Control+n");
    await page.getByTestId("desk-name-modal-input").fill("While waiting");
    await page.getByTestId("desk-name-modal-submit").click();
    await expect(page.locator('[data-testid^="desk-choice-"][aria-selected="true"]')).toContainText(
      "While waiting",
    );
    await expect(agentTabs).toHaveCount(0);
    await sidebar.getByTestId(`task-agent-${second.agentId}`).click();
    await expect(previewTab).toContainText("Review terrain");
    await page.getByTestId("desk-choice-primary").click();
    await expect(pinnedTabs).toHaveCount(2);
    await expect(previewTab).toHaveCount(0);

    // Desk cycling is deliberate; all pinned tabs return together.
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator('[data-testid^="desk-choice-"][aria-selected="true"]')).toContainText(
      "While waiting",
    );
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator('[data-testid^="desk-choice-"][aria-selected="true"]')).toContainText(
      "Primary tasks",
    );
    const newTab = desk.getByTestId("workspace-new-tab-button");
    await newTab.click();
    await expect(page.getByTestId("workspace-new-tab-menu-agent")).toBeVisible();
    await expect(page.getByTestId("workspace-new-tab-menu-terminal")).toBeVisible();
    await expect(page.getByTestId("workspace-new-tab-menu-browser")).toBeVisible();
    await page.keyboard.press("Escape");
    for (const kind of ["agent", "terminal"] as const) {
      await newTab.click();
      await page.getByTestId(`workspace-new-tab-menu-${kind}`).click();
      await expect(pinnedTabs).toHaveCount(3);
      const created = pinnedTabs.last();
      if (kind === "agent") {
        const draft = page
          .getByRole("textbox", { name: "Message agent...", exact: true })
          .filter({ visible: true });
        const projectIcon = page.getByTestId("composer-project-icon").filter({ visible: true });
        await expect(projectIcon).toBeVisible();
        const projectBefore = await projectIcon.getAttribute("aria-label");
        await draft.focus();
        await page.keyboard.press("ArrowUp");
        await expect(projectIcon).not.toHaveAttribute("aria-label", projectBefore!);
        await expect(pinnedTabs).toHaveCount(3);
        await draft.focus();
        const model = page.getByTestId("combined-model-selector").filter({ visible: true });
        const modelBefore = await model.innerText();
        await page.keyboard.press("ArrowLeft");
        await expect(model).toHaveText(modelBefore);
        await page.keyboard.press("Control+m");
        const favorite = page.getByRole("button", { name: "Add to favorites", exact: true }).last();
        await favorite.click();
        await page.keyboard.press("Escape");
        await draft.focus();
        await page.keyboard.press("ArrowLeft");
        await expect(model).not.toHaveText(modelBefore);
        const chosenModel = await model.innerText();
        await page.keyboard.press("ArrowUp");
        await expect(projectIcon).toHaveAttribute("aria-label", projectBefore!);
        await expect(model).toHaveText(chosenModel);
        await draft.fill("hello");
        const projectAfter = await projectIcon.getAttribute("aria-label");
        const modelAfter = await model.innerText();
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("ArrowLeft");
        await expect(projectIcon).toHaveAttribute("aria-label", projectAfter!);
        await expect(model).toHaveText(modelAfter);
        await expect(draft).toHaveValue("hello");
        await draft.fill("");
      }
      await created.click({ button: "middle" });
      await expect(pinnedTabs).toHaveCount(2);
    }
    await sidebar.getByTestId("task-navigation-project").click();
    await page.getByText("Select none", { exact: true }).click();
    await expect(sidebar.getByTestId(`task-agent-${first.agentId}`)).toHaveCount(0);
    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).toHaveCount(0);
    await page.getByText("Select all", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(sidebar.getByTestId(`task-agent-${first.agentId}`)).toBeVisible();
    await sidebar.getByTestId("task-navigation-sort").click();
    await page.getByText("Title A–Z", { exact: true }).click();
    await expect(sidebar.getByTestId("task-navigation-sort")).toContainText("Title A–Z");

    await expect(page.getByTestId("header-shortcuts")).not.toContainText("New workspace");
    await page.keyboard.down("Control");
    await expect(sidebar.getByTestId("task-shortcut-1")).toBeVisible();
    const firstTask = sidebar.getByTestId(/^task-agent-/).first();
    await page.keyboard.press("1");
    await page.keyboard.up("Control");
    await expect(firstTask).toHaveAttribute("aria-selected", "true");
    await expect(sidebar.getByTestId("task-shortcut-1")).toHaveCount(0);
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(sidebar).toBeVisible();
    await expect(pinnedTabs).toHaveCount(2);
    await expect(page.locator('[data-testid^="desk-choice-"][aria-selected="true"]')).toContainText(
      "Primary tasks",
    );
    await expect(sidebar.getByTestId("task-navigation-sort")).toContainText("Title A–Z");
    const search = await openCommandCenter(page);
    await search.getByTestId("command-center-input").fill("Review terrain changes");
    await page.keyboard.press("Enter");
    await expect(search).not.toBeVisible();
    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator('[data-testid^="desk-choice-"][aria-selected="true"]')).toContainText(
      "Primary tasks",
    );
    await expect(pinnedTabs).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath("task-navigation.png"), fullPage: true });
    await toggle.click();
    await expect(sidebar).toHaveCount(0);
    await expect(page.getByTestId("desk-screen")).toHaveCount(0);
    await expect(
      page.getByTestId(`sidebar-workspace-row-${getServerId()}:${first.workspaceId}`).first(),
    ).toBeVisible();
    await toggle.click();
    await expect(sidebar).toBeVisible();
    await expect(pinnedTabs).toHaveCount(2);
    await expect(sidebar.getByTestId("task-navigation-browse-workspaces")).toHaveCount(0);
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
});

test("Tasks mode row menu, pane toolbar, launch shortcuts, Desk moves and archived sessions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await installDesktopRuntime(page, {
    serverId: getServerId(),
    manageBuiltInDaemon: false,
    platform: "linux",
  });
  const first = await seedMockAgentWorkspace({
    repoPrefix: "task-menu-first-",
    title: "Row menu task",
  });
  try {
    await openAgentRoute(page, first);
    const toggle = page.getByTestId("task-navigation-switch").filter({ visible: true });
    await toggle.click();
    const sidebar = page.getByTestId("task-navigation-sidebar");
    const task = sidebar.getByTestId(`task-agent-${first.agentId}`);
    await expect(task).toBeVisible();

    // Right-click offers the workspace actions; rename acts on the session.
    await task.click({ button: "right" });
    const menu = page.getByTestId(
      `sidebar-workspace-context-menu-task-${getServerId()}:${first.agentId}`,
    );
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Copy path");
    await expect(menu).toContainText("Archive session");
    await menu.getByText("Rename session", { exact: true }).click();
    await page.getByTestId("task-rename-modal-input").fill("Renamed from the task menu");
    await page.getByTestId("task-rename-modal-submit").click();
    await expect(task).toContainText("Renamed from the task menu");

    await task.click({ button: "middle" });
    const desk = page.getByTestId("desk-screen");
    const pinnedTabs = desk.locator('[data-desk-tab="pinned"]');
    await expect(pinnedTabs).toHaveCount(1);

    // Split buttons sit directly in the pane toolbar, next to archive.
    await expect(desk.getByTestId("workspace-split-pane-menu")).toHaveCount(0);
    await expect(desk.getByTestId("workspace-split-pane-right")).toBeVisible();
    await expect(desk.getByTestId("workspace-archive-agent")).toBeVisible();
    const panes = desk.locator('[data-testid^="workspace-pane-"]');
    await desk.getByTestId("workspace-split-pane-down").click();
    await expect(panes).toHaveCount(2);
    await panes.nth(1).locator("[data-desk-tab]").click({ button: "middle" });
    await expect(panes).toHaveCount(1);

    // Ctrl+Shift+T opens a terminal in the Desk.
    await desk.getByTestId(`workspace-tab-agent_${first.agentId}`).click();
    await page.keyboard.press("Control+Shift+T");
    await expect(pinnedTabs).toHaveCount(2);
    await pinnedTabs.last().click({ button: "middle" });
    await expect(pinnedTabs).toHaveCount(1);

    // A tab moves to another Desk from its context menu.
    await page.keyboard.press("Control+n");
    await page.getByTestId("desk-name-modal-input").fill("Later");
    await page.getByTestId("desk-name-modal-submit").click();
    await expect(page.locator('[data-testid^="desk-choice-"][aria-selected="true"]')).toContainText(
      "Later",
    );
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator('[data-testid^="desk-choice-"][aria-selected="true"]')).toContainText(
      "Primary tasks",
    );
    await desk.getByTestId(`workspace-tab-agent_${first.agentId}`).click({ button: "right" });
    await page.getByTestId("workspace-tab-move-to").click();
    await page.locator('[data-testid^="workspace-tab-move-to-desk-"]').click();
    // The emptied Desk falls back to its New tab launcher.
    const agentTab = desk.getByTestId(`workspace-tab-agent_${first.agentId}`);
    await expect(agentTab).toHaveCount(0);
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator('[data-testid^="desk-choice-"][aria-selected="true"]')).toContainText(
      "Later",
    );
    await expect(agentTab).toBeVisible();

    // Archiving from the pane removes the task; the Archived filter lists it.
    await agentTab.click();
    await desk.getByTestId("workspace-archive-agent").click();
    await expect(task).toHaveCount(0);
    await expect(agentTab).toHaveCount(0);
    await sidebar.getByTestId("task-filter-archived").click();
    await expect(task).toBeVisible();
    await expect(task).toContainText("Renamed from the task menu");
  } finally {
    await first.cleanup();
  }
});

test("Tasks mode docks the focused task's Explorer", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await installDesktopRuntime(page, {
    serverId: getServerId(),
    manageBuiltInDaemon: false,
    platform: "linux",
  });
  const first = await seedMockAgentWorkspace({
    repoPrefix: "task-explorer-",
    title: "Explorer task",
  });
  try {
    await openAgentRoute(page, first);
    const toggle = page.getByTestId("task-navigation-switch").filter({ visible: true });
    await toggle.click();
    const sidebar = page.getByTestId("task-navigation-sidebar");
    await sidebar.getByTestId(`task-agent-${first.agentId}`).click({ button: "middle" });
    const desk = page.getByTestId("desk-screen");
    await expect(desk.locator('[data-desk-tab="pinned"]')).toHaveCount(1);

    // The header toggle opens the task workspace's Files and Changes beside the Desk.
    const explorer = desk.getByTestId("workspace-explorer-sidebar");
    await expect(explorer).toHaveCount(0);
    await desk.getByTestId("workspace-explorer-toggle").click();
    await expect(explorer).toBeVisible();
    await expect(explorer.getByTestId("workspace-tab-files")).toBeVisible();
    await expect(explorer.getByTestId("workspace-tab-changes_tree")).toBeVisible();
    await page.keyboard.press("Control+E");
    await expect(explorer).toHaveCount(0);
    await page.keyboard.press("Control+E");
    await expect(explorer).toBeVisible();

    // Open or closed belongs to the Desk tab: a new tab of the same workspace starts closed, and
    // the workspace view keeps its own state.
    const taskTab = desk.locator('[data-desk-tab="pinned"]').first();
    // The Explorer has its own + button after the Desk's.
    await desk.getByTestId("workspace-new-tab-button").first().click();
    await page.getByTestId("workspace-new-tab-menu-agent").click();
    await expect(explorer).toHaveCount(0);
    await taskTab.click();
    await expect(explorer).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId("workspace-explorer-sidebar")).toHaveCount(0);
  } finally {
    await first.cleanup();
  }
});
