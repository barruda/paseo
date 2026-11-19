import type { AgentMode, AgentSessionConfig } from "./agent-sdk-types.js";

/**
 * CUSTOM(unattended-automation): the one place that answers "what is this provider's
 * no-approval configuration?". Board runs, the delegation subagents and the Paseo agents
 * automation creates all go through it, so a provider or mode that appears later cannot
 * leave an automatic agent waiting on a permission nobody sees.
 */
export const PROVIDER_UNATTENDED_MODES: Readonly<Record<string, string>> = {
  claude: "bypassPermissions",
  codex: "full-access",
  copilot: "allow-all",
  omp: "full",
};

/**
 * Feature that carries unattendedness for providers whose modes cannot express it
 * (OpenCode and every ACP-backed provider).
 */
const AUTO_ACCEPT_FEATURE = "auto_accept";

/** Provider ids that take `auto_accept` as their permission switch. */
const AUTO_ACCEPT_PROVIDERS: ReadonlySet<string> = new Set([
  "opencode",
  "copilot",
  "cursor",
  "kimi",
  "kiro",
  "trae",
]);

/** A mode id or label that means "run tools without asking". */
const FULL_ACCESS_PATTERN =
  /bypass|full[-_ ]?access|full|yolo|danger|never[-_ ]?ask|allow[-_ ]?all|unrestricted|no[-_ ]?prompt/i;

export interface UnattendedCreateConfigInput {
  provider: string;
  modeId?: string;
  featureValues?: Record<string, unknown>;
  availableModes?: AgentMode[];
}

export interface ResolvedUnattendedCreateConfig {
  modeId: string | undefined;
  featureValues: Record<string, unknown> | undefined;
}

function modeIdOrUndefined(modeId: string | null | undefined): string | undefined {
  const trimmed = modeId?.trim();
  return trimmed ? trimmed : undefined;
}

function modeExists(modeId: string, modes: AgentMode[] | undefined): boolean {
  return modes === undefined || modes.some((mode) => mode.id === modeId);
}

function isFullAccessMode(mode: AgentMode): boolean {
  return (
    mode.isUnattended === true ||
    FULL_ACCESS_PATTERN.test(mode.id) ||
    FULL_ACCESS_PATTERN.test(mode.label)
  );
}

/** The provider's own full-access mode, even when its catalog has not loaded yet. */
export function providerUnattendedMode(provider: string): string | undefined {
  return PROVIDER_UNATTENDED_MODES[provider];
}

/**
 * Whether an agent config already runs without approval. Used by the daemon to decide
 * whether a permission request arriving at the manager should be auto-approved.
 */
export function isUnattendedAgentConfig(
  config: Pick<AgentSessionConfig, "provider" | "modeId" | "featureValues">,
): boolean {
  const modeId = modeIdOrUndefined(config.modeId);
  if (modeId) {
    if (providerUnattendedMode(config.provider) === modeId) return true;
    if (FULL_ACCESS_PATTERN.test(modeId)) return true;
  }
  return config.featureValues?.[AUTO_ACCEPT_FEATURE] === true;
}

/** Whether this mode id is the provider's own or a recognizable full-access mode. */
export function isFullAccessModeId(provider: string, modeId: string | null | undefined): boolean {
  const id = modeIdOrUndefined(modeId);
  if (!id) return false;
  return providerUnattendedMode(provider) === id || FULL_ACCESS_PATTERN.test(id);
}

/** Drop a mode the provider does not know, so unattended creation never fails on it. */
export function sanitizeRequestedMode(input: {
  provider: string;
  modeId: string | null | undefined;
  availableModes: AgentMode[] | undefined;
}): string | undefined {
  const modeId = modeIdOrUndefined(input.modeId);
  if (!modeId) return undefined;
  if (providerUnattendedMode(input.provider) === modeId) return modeId;
  return modeExists(modeId, input.availableModes) ? modeId : undefined;
}

/**
 * Resolve the mode and features that make an automatic creation stop asking for approval.
 * A known provider mode wins; then a mode the provider itself marks unattended; then a mode
 * whose id or label reads as full access; finally a requested mode that still exists.
 */
export function resolveUnattendedCreateConfig(
  input: UnattendedCreateConfigInput,
): ResolvedUnattendedCreateConfig {
  const modes = input.availableModes;
  const requested = modeIdOrUndefined(input.modeId);
  const known = providerUnattendedMode(input.provider);
  const fallback =
    requested && (modeExists(requested, modes) || FULL_ACCESS_PATTERN.test(requested))
      ? requested
      : undefined;

  const modeId =
    input.provider === "opencode"
      ? resolveOpenCodeMode(fallback, modes)
      : ((known && modeExists(known, modes) ? known : undefined) ??
        modes?.find((mode) => mode.isUnattended === true)?.id ??
        modes?.find(isFullAccessMode)?.id ??
        fallback);

  return {
    modeId,
    featureValues: withAutoAccept(input.provider, input.featureValues),
  };
}

/** OpenCode users can rename or delete any agent, so never send a mode it does not have. */
function resolveOpenCodeMode(
  fallback: string | undefined,
  modes: AgentMode[] | undefined,
): string | undefined {
  if (fallback === "full-access") {
    return modeExists("build", modes) ? "build" : undefined;
  }
  if (fallback && modes === undefined) {
    // A mode from another provider is stale even before OpenCode's catalog loads.
    const foreign = Object.values(PROVIDER_UNATTENDED_MODES).includes(fallback);
    return foreign ? undefined : fallback;
  }
  return fallback && modeExists(fallback, modes) ? fallback : undefined;
}

function withAutoAccept(
  provider: string,
  featureValues: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!AUTO_ACCEPT_PROVIDERS.has(provider) && featureValues?.[AUTO_ACCEPT_FEATURE] === undefined)
    return featureValues;
  return { ...featureValues, [AUTO_ACCEPT_FEATURE]: true };
}
