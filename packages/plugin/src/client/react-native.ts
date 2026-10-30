import type { ComponentType } from "react";

// COMPAT(pluginReactNativeEntrypoint): added in v0.13.0, remove after 2027-04-20
/** @deprecated Import Paseo UI from @getpaseo/plugin/client/ui. */
export * from "./ui.js";

/** @deprecated Render StreamedText from @getpaseo/plugin/client/ui. Removed after 2027-04-20 with this entry. */
export declare function useRevealedText(text: string, phase: "streaming" | "complete"): string;

/** CUSTOM(btw-actions): what a follow-up prompt sends: its text and the files uploaded with it. */
export interface FollowUpComposerSubmission {
  text: string;
  files: { fileName: string; mimeType: string; path: string }[];
}

export interface FollowUpComposerProps {
  serverId: string;
  agentId: string;
  placeholder?: string;
  disabled?: boolean;
  onSubmit(submission: FollowUpComposerSubmission): void | Promise<void>;
  /** Esc in the input. */
  onCancel?(): void;
}

/**
 * CUSTOM(btw-actions): the chat composer's input (dictation, file attachments, send) for a
 * plugin's own prompt. Files upload to the daemon, which can read them at `path`.
 */
export declare const FollowUpComposer: ComponentType<FollowUpComposerProps>;

export interface AgentForkMenuProps {
  serverId: string;
  agentId: string;
  /** Text appended to the branch's chat history, read when the branch is made. */
  extraContext(): string;
  testID?: string;
}

/**
 * CUSTOM(btw-actions): the chat's branch button. Branches the agent's whole chat history plus
 * `extraContext` into a new tab or workspace; in Tasks mode, straight into a tab.
 */
export declare const AgentForkMenu: ComponentType<AgentForkMenuProps>;
