import { test, expect } from "../../app/e2e/support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../../app/e2e/support/helpers/mock-agent";
import { getServerId } from "../../app/e2e/support/helpers/server-id";
import { installDesktopRuntime } from "./support/runtime";

test("task navigation switches across workspaces, clears read completions, and preserves the fallback", async ({
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
    await expect(page).toHaveURL(new RegExp(`/workspace/${second.workspaceId}`));
    await expect(sidebar.getByTestId("task-filter-review")).toHaveText("Ready to review 0");
    await sidebar.getByTestId("task-filter-all").click();
    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(sidebar.getByTestId(`task-agent-${second.agentId}`)).not.toContainText(
      "Ready to review",
    );

    await page.reload();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(sidebar).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("task-navigation.png"), fullPage: true });
    await toggle.click();
    await expect(sidebar).toHaveCount(0);
    await expect(
      page.getByTestId(`sidebar-workspace-row-${getServerId()}:${second.workspaceId}`).first(),
    ).toBeVisible();
    await toggle.click();
    await expect(sidebar).toBeVisible();
    await sidebar.getByTestId("task-navigation-browse-workspaces").click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(sidebar).toHaveCount(0);
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
});
