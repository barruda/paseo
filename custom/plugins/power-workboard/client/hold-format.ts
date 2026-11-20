// CUSTOM(resource-pools): the text of a pool hold, shared by the Orchestrators panel (zh/en) and
// the Projects Dashboard's waiting fixes (en/pt-BR).
import type { OrchestratorHold } from "../shared/hold";

export interface HoldTemplates {
  /** {pool}, {running}, {max} */
  holdPool: string;
  /** {free}, {pool}, {min} */
  holdRam: string;
  /** {pool}, {time} */
  holdSettle: string;
  /** {task}, {directory} */
  holdFolder: string;
}

export function formatHold(
  hold: OrchestratorHold,
  templates: HoldTemplates,
  locale: string,
): string {
  if (hold.kind === "folder")
    return templates.holdFolder
      .replace("{task}", hold.taskTitle ?? "another task")
      .replace("{directory}", hold.directory);
  if (hold.kind === "pool")
    return templates.holdPool
      .replace("{pool}", hold.poolName)
      .replace("{running}", String(hold.running))
      .replace("{max}", String(hold.maxConcurrent));
  if (hold.kind === "settle")
    return templates.holdSettle.replace("{pool}", hold.poolName).replace(
      "{time}",
      hold.until
        ? new Date(hold.until).toLocaleTimeString(locale, {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "?",
    );
  return templates.holdRam
    .replace(
      "{free}",
      hold.freeRamPercent === null ? "?" : String(hold.freeRamPercent),
    )
    .replace("{pool}", hold.poolName)
    .replace(
      "{min}",
      hold.minFreeRamPercent === null ? "?" : String(hold.minFreeRamPercent),
    );
}
