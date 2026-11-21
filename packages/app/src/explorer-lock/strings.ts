// CUSTOM(explorer-lock): the setting's strings. Kept out of the locale files like the other custom
// surfaces; pt-BR when the UI language starts with "pt", else English.
export interface ExplorerLockStrings {
  section: string;
  tasksTitle: string;
  tasksHint: string;
  workspacesTitle: string;
  workspacesHint: string;
}

export const explorerLockStringsEn: ExplorerLockStrings = {
  section: "Right sidebar",
  tasksTitle: "Keep the right sidebar open or closed in Tasks mode",
  tasksHint:
    "Switching tabs, agents, Desks or workspaces leaves the right sidebar as it is; only its button and Ctrl+E open or close it. Off, each tab remembers its own.",
  workspacesTitle: "Keep the right sidebar open or closed in workspaces",
  workspacesHint:
    "The same for the workspace view: switching workspaces leaves it as it is. Off, each workspace remembers its own.",
};

export const explorerLockStringsPtBr: ExplorerLockStrings = {
  section: "Barra lateral direita",
  tasksTitle: "Manter a barra lateral direita aberta ou fechada no Tasks mode",
  tasksHint:
    "Trocar de aba, agente, Desk ou workspace não muda a barra lateral direita; só o botão dela e o Ctrl+E abrem ou fecham. Desligado, cada aba lembra o próprio estado.",
  workspacesTitle: "Manter a barra lateral direita aberta ou fechada nos workspaces",
  workspacesHint:
    "O mesmo na visão de workspace: trocar de workspace não muda a barra. Desligado, cada workspace lembra o próprio estado.",
};

export function explorerLockStrings(language: string | undefined): ExplorerLockStrings {
  return language?.startsWith("pt") ? explorerLockStringsPtBr : explorerLockStringsEn;
}
