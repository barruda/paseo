import path from "node:path";
import type { Page } from "@playwright/test";
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
    flexibleTabMovement: true, // CUSTOM(flexible-tabs)
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
    // Ctrl+T works from inside the panel's terminal and opens the new tab in the panel.
    const launcherTab = bottom.locator('[data-testid^="workspace-tab-desk-"]');
    await page.keyboard.press("Control+t");
    await expect(launcherTab).toHaveCount(1);
    await page.keyboard.press("Control+w");
    await expect(launcherTab).toHaveCount(0);
    await page.keyboard.press("Control+j");
    await expect(bottom).not.toBeVisible();
    await page.keyboard.press("Control+j");
    await expect(bottom).toBeVisible();
    await expect.poll(countTerminals).toBe(1);
    // CUSTOM(bottom-panel-collapse): the ⌄⌄ button before the panel's tabs hides it.
    const collapse = bottom.getByTestId("bottom-panel-collapse");
    const firstTabBox = await bottom
      .locator('[data-testid^="workspace-tab-terminal_"]')
      .boundingBox();
    expect((await collapse.boundingBox())!.x).toBeLessThan(firstTabBox!.x);
    await collapse.click();
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
    // A terminal the daemon no longer runs (its shell exited, or the daemon restarted) loses its
    // Desk tab instead of leaving a blank one.
    await page.keyboard.press("Control+j");
    const deadTab = bottom.locator('[data-testid^="workspace-tab-terminal_"]');
    const deadTerminalId = (await deadTab.getAttribute("data-testid"))!.replace(
      "workspace-tab-terminal_",
      "",
    );
    await second.client.killTerminal(deadTerminalId);
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
    await sidebar.getByTestId(`task-agent-${first.agentId}`).click();
    await expect(previewTab).toContainText("Investigate sidebar");
    // CUSTOM(task-double-click): a double click opens the task in a new tab and keeps the preview.
    await sidebar.getByTestId(`task-agent-${second.agentId}`).dblclick();
    await expect(pinnedTabs).toHaveCount(1);
    await expect(pinnedTabs).toContainText("Review terrain");
    await expect(previewTab).toContainText("Investigate sidebar");
    await previewTab.click();
    await page.getByTestId("desk-keep-preview").click();
    await expect(pinnedTabs).toHaveCount(2);
    await expect(previewTab).toHaveCount(0);

    // The workspace tab menu, with the customized actions, works on Desk tabs.
    await desk.getByTestId(`workspace-tab-agent_${second.agentId}`).click({ button: "right" });
    await expect(
      page.locator('[data-testid^="workspace-tab-context-"][data-testid$="-copy-agent-id"]'),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // CUSTOM(tab-lanes): Desk tabs sit in free rows. Dragging shows a row below the tab bar; a tab
    // dropped there stays where it was dropped, and dragging it back makes one row again.
    const tabsRow = desk.getByTestId("workspace-tabs-row");
    const oneRowHeight = (await tabsRow.boundingBox())!.height;
    const laneTab = desk.getByTestId(`workspace-tab-agent_${second.agentId}`).first();
    const dragLaneTab = async (dx: number, dy: number) => {
      const box = (await laneTab.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 12, y + 4, { steps: 4 });
      await expect(desk.getByTestId("tab-lanes-extra-row")).toBeVisible();
      await page.mouse.move(x + dx, y + dy, { steps: 12 });
      await page.mouse.up();
      await expect(desk.getByTestId("tab-lanes-extra-row")).toHaveCount(0);
      return box;
    };
    const before = await dragLaneTab(400, 32);
    await expect
      .poll(async () => (await tabsRow.boundingBox())!.height)
      .toBeGreaterThan(oneRowHeight + 20);
    const dropped = (await laneTab.boundingBox())!;
    expect(dropped.y).toBeGreaterThan(before.y + 20);
    expect(dropped.x).toBeGreaterThan(before.x + 300);
    await page.mouse.move(800, 600);
    await page.screenshot({ path: testInfo.outputPath("tab-lanes.png") });
    await dragLaneTab(-400, -32);
    await expect.poll(async () => (await tabsRow.boundingBox())!.height).toBe(oneRowHeight);
    // CUSTOM(flexible-tabs): the leading refresh button packs every tab back into one row.
    await dragLaneTab(400, 32);
    await expect
      .poll(async () => (await tabsRow.boundingBox())!.height)
      .toBeGreaterThan(oneRowHeight + 20);
    await desk.getByTestId("tab-lanes-tidy").click();
    await expect.poll(async () => (await tabsRow.boundingBox())!.height).toBe(oneRowHeight);

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
    // CUSTOM(tab-pins): "Pin tab" moves the tab to the left of the row and marks it pinned.
    const lastAgentTab = agentTabs.last();
    const lastAgentTabId = await lastAgentTab.getAttribute("data-testid");
    await lastAgentTab.click({ button: "right" });
    await page.locator('[data-testid^="workspace-tab-context-"][data-testid$="-pin-tab"]').click();
    await expect(agentTabs.first()).toHaveAttribute("data-testid", lastAgentTabId ?? "");
    await expect(desk.locator('[data-tab-pin="pinned"]')).toHaveCount(1);
    await page.mouse.move(800, 600);
    await desk.locator('[data-tab-pin="pinned"]').screenshot({
      path: testInfo.outputPath("tab-pin.png"),
    });
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

    // Pin repeats the session under the filters and keeps it in its usual place; Unpin removes it.
    const pinned = sidebar.getByTestId(`task-pinned-${first.agentId}`);
    await expect(pinned).toHaveCount(0);
    await task.click({ button: "right" });
    await menu.getByText("Pin", { exact: true }).click();
    await expect(pinned).toContainText("Renamed from the task menu");
    await expect(task).toBeVisible();

    await task.click({ button: "middle" });
    const desk = page.getByTestId("desk-screen");
    const pinnedTabs = desk.locator('[data-desk-tab="pinned"]');
    await expect(pinnedTabs).toHaveCount(1);
    // Agent tabs show the project's icon instead of the provider's.
    await expect(
      desk
        .getByTestId(`workspace-tab-agent_${first.agentId}`)
        .getByTestId("agent-tab-project-icon"),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("agent-tab-project-icon.png") });

    // Only the copy that was clicked shows as selected.
    await expect(task).toHaveAttribute("aria-selected", "true");
    await expect(pinned).toHaveAttribute("aria-selected", "false");
    await pinned.click();
    await expect(pinned).toHaveAttribute("aria-selected", "true");
    await expect(task).toHaveAttribute("aria-selected", "false");

    // The agent tab's context menu unpins and pins too.
    const tabPin = page.locator('[data-testid^="workspace-tab-context-"][data-testid$="-pin"]');
    await desk.getByTestId(`workspace-tab-agent_${first.agentId}`).click({ button: "right" });
    await expect(tabPin).toHaveText("Unpin from Tasks");
    await tabPin.click();
    await expect(pinned).toHaveCount(0);
    await expect(task).toHaveAttribute("aria-selected", "true");
    await desk.getByTestId(`workspace-tab-agent_${first.agentId}`).click({ button: "right" });
    await expect(tabPin).toHaveText("Pin to Tasks");
    await tabPin.click();
    await expect(pinned).toBeVisible();
    await pinned.click({ button: "right" });
    await menu.getByText("Unpin", { exact: true }).click();
    await expect(pinned).toHaveCount(0);

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

    // The tab row's toggle, 50px right of the pane buttons, opens the task workspace's Files and
    // Changes beside the Desk.
    const explorer = desk.getByTestId("workspace-explorer-sidebar");
    await expect(explorer).toHaveCount(0);
    const explorerToggle = desk.getByTestId("workspace-explorer-toggle");
    const toggleBox = await explorerToggle.boundingBox();
    const archiveBox = await desk.getByTestId("workspace-archive-agent").boundingBox();
    expect(toggleBox && archiveBox).toBeTruthy();
    if (toggleBox && archiveBox) {
      expect(toggleBox.x - (archiveBox.x + archiveBox.width)).toBeCloseTo(50, -1);
      expect(toggleBox.y).toBeCloseTo(archiveBox.y, -1);
    }
    await explorerToggle.click();
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

// CUSTOM(new-agent-projects): hovering the + menu's Agent row lists projects; one click starts a
// draft in the picked project, in the workspace view and in a Desk.
test("New agent flyout starts a draft in the picked project", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await installDesktopRuntime(page, {
    serverId: getServerId(),
    manageBuiltInDaemon: false,
    platform: "linux",
  });
  const first = await seedMockAgentWorkspace({
    repoPrefix: "new-agent-first-",
    title: "First project task",
  });
  const second = await seedMockAgentWorkspace({
    repoPrefix: "new-agent-second-",
    title: "Second project task",
  });
  try {
    await openAgentRoute(page, first);
    const secondName = path.basename(second.cwd);
    const projectIcon = page.getByTestId("composer-project-icon").filter({ visible: true });
    const pickSecondProject = async () => {
      await page.getByTestId("workspace-new-tab-button").filter({ visible: true }).first().click();
      await page.getByTestId("workspace-new-tab-menu-agent").hover();
      await page
        .locator('[data-testid^="new-agent-project-"]')
        .filter({ hasText: secondName })
        .click();
      await expect(projectIcon).toHaveAttribute("aria-label", secondName);
    };

    // Workspace view: the draft opens in the second project's workspace.
    await pickSecondProject();
    await expect(page).toHaveURL(new RegExp(second.workspaceId));

    // A click on the row itself still opens the default agent, without the flyout.
    await page.getByTestId("workspace-new-tab-button").filter({ visible: true }).first().click();
    await page.getByTestId("workspace-new-tab-menu-agent").click();
    await expect(page.getByTestId("workspace-new-tab-menu")).toHaveCount(0);

    // Tasks mode: the draft lands in the Desk, owned by the second project.
    await page.getByTestId("task-navigation-switch").filter({ visible: true }).click();
    const sidebar = page.getByTestId("task-navigation-sidebar");
    await sidebar.getByTestId(`task-agent-${first.agentId}`).click({ button: "middle" });
    const desk = page.getByTestId("desk-screen");
    const pinnedTabs = desk.locator('[data-desk-tab="pinned"]');
    const before = await pinnedTabs.count();
    await pickSecondProject();
    await expect(pinnedTabs).toHaveCount(before + 1);
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
});

// CUSTOM(task-navigation-compact): the phone picks Tasks or Workspaces in its own sidebar.
test("Phone sidebar lists tasks, opens one in its workspace and switches to Workspaces", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installDesktopRuntime(page, {
    serverId: getServerId(),
    manageBuiltInDaemon: false,
    platform: "linux",
  });
  const first = await seedMockAgentWorkspace({
    repoPrefix: "task-nav-phone-first-",
    title: "Follow the phone sidebar",
  });
  const second = await seedMockAgentWorkspace({
    repoPrefix: "task-nav-phone-second-",
    title: "Check the terrain on the phone",
    initialPrompt: "Finish this turn.",
  });
  try {
    await second.client.waitForFinish(second.agentId, 20_000);
    await openAgentRoute(page, first);
    await openPhoneMenu(page);
    const sidebar = page.getByTestId("task-navigation-sidebar");
    await expect(page.getByTestId("compact-sidebar-mode")).toBeVisible();
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByTestId(`task-agent-${first.agentId}`)).toBeVisible();
    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("phone-tasks.png") });

    await sidebar.getByTestId(`task-agent-${second.agentId}`).click();
    await expect(page.getByTestId("desk-screen")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/workspace/${second.workspaceId}`));
    await openPhoneMenu(page);
    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.getByTestId("compact-sidebar-mode-workspaces").click();
    await expect(sidebar).toHaveCount(0);
    await expect(
      page.getByTestId(`sidebar-workspace-row-${getServerId()}:${first.workspaceId}`).first(),
    ).toBeVisible();
    await page.reload();
    await openPhoneMenu(page);
    await expect(page.getByTestId("compact-sidebar-mode")).toBeVisible();
    await expect(page.getByTestId("task-navigation-sidebar")).toHaveCount(0);
    await page.getByTestId("compact-sidebar-mode-tasks").click();
    await expect(page.getByTestId("task-navigation-sidebar")).toBeVisible();
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
});

/** The web deck keeps earlier workspaces mounted, each with its own hidden menu button. */
async function openPhoneMenu(page: Page) {
  await page.getByTestId("menu-button").filter({ visible: true }).click();
}
