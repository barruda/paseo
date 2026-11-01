// CUSTOM(clear-keeps-agent): `/clear` turns the tab into a fresh draft with the same setup and
// leaves the old agent alive as its own idle task. Only `/exit` archives.
import type { ClientSlashCommand } from "./index";

export function clientSlashCommandArchivesAgent(
  command: Pick<ClientSlashCommand, "kind">,
): boolean {
  return command.kind === "archive-agent";
}
