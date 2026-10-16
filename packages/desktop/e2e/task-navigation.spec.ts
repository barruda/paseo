import { test, expect } from "../../app/e2e/support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../../app/e2e/support/helpers/mock-agent";
import { openCommandCenter } from "../../app/e2e/support/helpers/command-center";
import { getServerId } from "../../app/e2e/support/helpers/server-id";
import { installDesktopRuntime } from "./support/runtime";

test("Desks preview and pin across projects, restore tab sets, filter, and preserve workspace fallback", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await installDesktopRuntime(page, { serverId: getServerId(), manageBuiltInDaemon: false });
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
    // Previewing another project keeps the Desk and its route stable.
    await expect(page).toHaveURL(new RegExp(`/workspace/${first.workspaceId}`));
    await expect(page.getByTestId("desk-preview-tab")).toContainText("Review terrain…");
    await expect(sidebar.getByTestId("task-filter-review")).toHaveText("Ready to review 0");
    await sidebar.getByTestId("task-filter-all").click();
    await expect(
      sidebar.getByTestId(`task-agent-${second.agentId}`).getByTestId("task-project-icon"),
    ).toBeVisible();
    await expect(
      page.getByTestId("desk-preview-tab").getByTestId("task-project-icon"),
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
    await composer.fill("Draft for terrain");
    await sidebar.getByTestId(`task-agent-${first.agentId}`).click();
    await expect(composer).toHaveValue("");
    await sidebar.getByTestId(`task-agent-${second.agentId}`).click();
    await expect(composer).toHaveValue("Draft for terrain");
    await composer.fill("");
    await page
      .getByTestId("desk-preview-tab")
      .getByTestId(/^desk-tab-/)
      .click({ button: "middle" });
    await expect(page.getByTestId("desk-preview-tab")).toHaveCount(0);
    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).toBeVisible();
    await sidebar.getByTestId(`task-agent-${second.agentId}`).click({ button: "middle" });
    await expect(page.getByTestId("desk-pinned-tab")).toHaveCount(1);
    await sidebar.getByTestId(`task-agent-${first.agentId}`).click();
    await expect(page.getByTestId("desk-preview-tab")).toContainText("Investigate si…");
    await expect(page.getByTestId("desk-pinned-tab")).toContainText("Review terrain…");
    await page.getByTestId("desk-keep-preview").click();
    await expect(page.getByTestId("desk-pinned-tab")).toHaveCount(2);
    await expect(page.getByTestId("desk-preview-tab")).toHaveCount(0);

    await page.getByTestId("desk-selector").click();
    await page.getByTestId("desk-create").click();
    await page.getByTestId("desk-name-modal-input").fill("While waiting");
    await page.getByTestId("desk-name-modal-submit").click();
    await expect(page.getByTestId("desk-selector")).toContainText("While waiting");
    await expect(page.getByTestId("desk-pinned-tab")).toHaveCount(0);
    await sidebar.getByTestId(`task-agent-${second.agentId}`).click();
    await expect(page.getByTestId("desk-preview-tab")).toContainText("Review terrain…");
    await page.getByTestId("desk-selector").click();
    await page.getByTestId("desk-choice-primary").click();
    await expect(page.getByTestId("desk-pinned-tab")).toHaveCount(2);

    // Desk cycling is deliberate; all pinned tabs return together.
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("desk-selector")).toContainText("While waiting");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("desk-selector")).toContainText("Primary tasks");
    await page.getByRole("button", { name: "Add tab to Desk", exact: true }).click();
    await expect(page.getByTestId("workspace-new-tab-menu-agent")).toBeVisible();
    await expect(page.getByTestId("workspace-new-tab-menu-terminal")).toBeVisible();
    await expect(page.getByTestId("workspace-new-tab-menu-browser")).toBeVisible();
    await page.getByTestId("workspace-new-tab-menu-files").click();
    await expect(page.getByTestId("desk-pinned-tab")).toHaveCount(3);
    await page.getByRole("button", { name: "Close Files", exact: true }).click();
    await expect(page.getByTestId("desk-pinned-tab")).toHaveCount(2);
    for (const kind of ["agent", "terminal"] as const) {
      await page.getByRole("button", { name: "Add tab to Desk", exact: true }).click();
      await page.getByTestId(`workspace-new-tab-menu-${kind}`).click();
      await expect(page.getByTestId("desk-pinned-tab")).toHaveCount(3);
      const created = page.getByTestId("desk-pinned-tab").last();
      await expect(created.getByTestId("task-project-icon")).toBeVisible();
      await created.getByTestId(/^desk-tab-/).click({ button: "middle" });
      await expect(page.getByTestId("desk-pinned-tab")).toHaveCount(2);
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

    await page.reload();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(sidebar).toBeVisible();
    await expect(page.getByTestId("desk-pinned-tab")).toHaveCount(2);
    await expect(page.getByTestId("desk-selector")).toContainText("Primary tasks");
    await expect(sidebar.getByTestId("task-navigation-sort")).toContainText("Title A–Z");
    const search = await openCommandCenter(page);
    await search.getByTestId("command-center-input").fill("Review terrain changes");
    await page.keyboard.press("Enter");
    await expect(search).not.toBeVisible();
    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("desk-selector")).toContainText("Primary tasks");
    await expect(page.getByTestId("desk-pinned-tab")).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath("task-navigation.png"), fullPage: true });
    await toggle.click();
    await expect(sidebar).toHaveCount(0);
    await expect(page.getByTestId("desk-screen")).toHaveCount(0);
    await expect(
      page.getByTestId(`sidebar-workspace-row-${getServerId()}:${first.workspaceId}`).first(),
    ).toBeVisible();
    await toggle.click();
    await expect(sidebar).toBeVisible();
    await expect(page.getByTestId("desk-pinned-tab")).toHaveCount(2);
    await expect(sidebar.getByTestId("task-navigation-browse-workspaces")).toHaveCount(0);
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
});
