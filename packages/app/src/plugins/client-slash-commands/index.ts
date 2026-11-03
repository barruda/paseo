import { useMemo } from "react";
import { createPluginAgentActionContext, createPluginWorkspaceActionContext } from "../actions";
import { createPluginClientStateSource } from "../client-state/source";
import { createPluginNavigation } from "../navigation";
import { useInstalledPlugins } from "../registry";

export interface PluginClientSlashCommand {
  pluginId: string;
  name: string;
  description: string;
  argumentHint: string;
  run(args: string): Promise<void>;
}

export function usePluginClientSlashCommands(input: {
  serverId: string;
  workspaceId: string | null | undefined;
  agentId: string;
  /**
   * CUSTOM(draft-composer-ready): a draft passes this, so its composer also offers the commands
   * that need an agent (`!`, `/sh`, ...). Running one creates the session with no first message,
   * resolves to the new agent's id, and then runs the command on that agent.
   */
  createAgent?: () => Promise<string>;
}): PluginClientSlashCommand[] {
  const installed = useInstalledPlugins();
  return useMemo(() => {
    if (!input.workspaceId) return [];
    const workspaceId = input.workspaceId;
    const state = createPluginClientStateSource(input.serverId);
    const navigation = createPluginNavigation({
      serverId: input.serverId,
      workspaceId,
    });
    const commands = installed
      .filter((plugin) => plugin.serverId === input.serverId)
      .flatMap((plugin) =>
        plugin.clientSlashCommands.flatMap((contribution) => {
          const createAgent = input.createAgent; // CUSTOM(draft-composer-ready)
          const needsAgent = contribution.context === "agent" && !state.getAgent(input.agentId);
          if (needsAgent && !createAgent) return [];
          if (!state.getWorkspace(workspaceId)) return [];
          return [
            {
              pluginId: plugin.id,
              name: contribution.name,
              description: plugin.i18n.resolve(contribution.description, plugin.locale),
              argumentHint: plugin.i18n.resolve(contribution.argumentHint, plugin.locale),
              async run(args: string) {
                // CUSTOM(draft-composer-ready): create the draft's agent first. A session started
                // in a new worktree belongs to that worktree's workspace.
                if (needsAgent && createAgent && contribution.context === "agent") {
                  const agentId = await createAgent();
                  const agent = state.getAgent(agentId);
                  if (!agent) throw new Error(`The new agent ${agentId} is not loaded yet`);
                  const context = createPluginAgentActionContext({
                    plugin,
                    navigation: createPluginNavigation({
                      serverId: input.serverId,
                      workspaceId: agent.workspaceId,
                    }),
                    state,
                    workspaceId: agent.workspaceId,
                    agentId,
                  });
                  if (!context) throw new Error(`The new agent ${agentId} has no workspace`);
                  await contribution.onSubmit({ ...context, args });
                  return;
                }
                const context =
                  contribution.context === "agent"
                    ? createPluginAgentActionContext({
                        plugin,
                        navigation,
                        state,
                        workspaceId,
                        agentId: input.agentId,
                      })
                    : createPluginWorkspaceActionContext({
                        plugin,
                        navigation,
                        state,
                        workspaceId,
                      });
                if (contribution.context === "agent" && context?.context === "agent")
                  await contribution.onSubmit({ ...context, args });
                else if (contribution.context === "workspace" && context?.context === "workspace")
                  await contribution.onSubmit({ ...context, args });
              },
            },
          ];
        }),
      );
    return commands;
  }, [input.agentId, input.createAgent, input.serverId, input.workspaceId, installed]);
}
