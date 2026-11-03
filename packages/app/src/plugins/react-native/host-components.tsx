// CUSTOM(btw-actions): app components lent to plugins. Required lazily, like `TextInput`, so the
// plugin runtime does not pull the composer and fork code in while it loads.
import type {
  AgentForkMenuProps,
  FollowUpComposerProps,
  RestartAgentButtonProps,
} from "@getpaseo/plugin/client/react-native";

export function FollowUpComposer(props: FollowUpComposerProps) {
  const { FollowUpComposer: Impl } =
    require("./follow-up-composer.impl") as typeof import("./follow-up-composer.impl");
  return <Impl {...props} />;
}

export function AgentForkMenu(props: AgentForkMenuProps) {
  const { AgentForkMenu: Impl } =
    require("./agent-fork-menu.impl") as typeof import("./agent-fork-menu.impl");
  return <Impl {...props} />;
}

// CUSTOM(jev-router)
export function RestartAgentButton(props: RestartAgentButtonProps) {
  const { RestartAgentButton: Impl } =
    require("./restart-agent-button.impl") as typeof import("./restart-agent-button.impl");
  return <Impl {...props} />;
}
