// CUSTOM(unattended-automation): what "permission" means for an orchestrator or the Projects
// Assistant, shared by the server (what it starts) and the form (what it shows).

/**
 * Providers whose mode is the agent (Build/Plan) and whose permission is the `auto_accept`
 * feature. Copilot is not here: it has an `allow-all` mode.
 */
export const FEATURE_PERMISSION_PROVIDERS: ReadonlySet<string> = new Set([
  "opencode",
  "cursor",
  "kimi",
  "kiro",
  "trae",
]);

/** The daemon's reading of a mode id or label as "run tools without asking". */
const FULL_ACCESS_PATTERN =
  /bypass|full[-_ ]?access|full|yolo|danger|never[-_ ]?ask|allow[-_ ]?all|unrestricted|no[-_ ]?prompt/i;

/** `provider/model` to `provider`. */
export function providerIdOf(value: string): string {
  const slash = value.indexOf("/");
  return slash < 0 ? value : value.slice(0, slash);
}

export function isFeaturePermissionProvider(value: string): boolean {
  return FEATURE_PERMISSION_PROVIDERS.has(providerIdOf(value));
}

export function isFullAccessModeId(modeId: string | null | undefined): boolean {
  const id = modeId?.trim();
  return !!id && FULL_ACCESS_PATTERN.test(id);
}

/** Whether an agent started with this config runs without asking for permission. */
export function runsUnattended(config: {
  provider: string;
  modeId: string | null | undefined;
  autoAccept: boolean;
}): boolean {
  if (isFeaturePermissionProvider(config.provider)) return config.autoAccept;
  return !config.modeId?.trim() || isFullAccessModeId(config.modeId);
}

/** The provider's full-access mode: the dangerous-tier one, else the first that reads as such. */
export function fullAccessModeOf<
  T extends { id: string; label: string; colorTier?: string },
>(modes: readonly T[]): T | undefined {
  return (
    modes.find((mode) => mode.colorTier === "dangerous") ??
    modes.find(
      (mode) => isFullAccessModeId(mode.id) || isFullAccessModeId(mode.label),
    )
  );
}
