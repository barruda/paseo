import { describe, expect, it } from "vitest";
import { resolveEmbedHostRoute } from "./embed-host-route";

const base = {
  hostKnown: false,
  hostRegistryLoading: false,
  startupBlocked: false,
  bootSettled: true,
};

describe("resolveEmbedHostRoute", () => {
  it("renders once the host is known", () => {
    expect(resolveEmbedHostRoute({ ...base, hostKnown: true, bootSettled: false })).toBe("render");
  });

  it("shows loading while the registry or boot is pending", () => {
    expect(resolveEmbedHostRoute({ ...base, hostRegistryLoading: true })).toBe("loading");
    expect(resolveEmbedHostRoute({ ...base, startupBlocked: true })).toBe("loading");
    expect(resolveEmbedHostRoute({ ...base, bootSettled: false })).toBe("loading");
  });

  it("reports unavailable instead of redirecting when the host stays unknown", () => {
    expect(resolveEmbedHostRoute(base)).toBe("unavailable");
  });
});
