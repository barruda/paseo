import { describe, expect, it } from "vitest";
import { createMediaPauser, type MprisBus } from "./media-pause";

function fakeBus(initial: Record<string, string>) {
  const status = new Map(Object.entries(initial));
  const calls: string[] = [];
  const bus: MprisBus = {
    listPlayers: async () => [...status.keys()],
    playbackStatus: async (player) => status.get(player) ?? null,
    call: async (player, method) => {
      calls.push(`${player}.${method}`);
      status.set(player, method === "Pause" ? "Paused" : "Playing");
    },
  };
  return { bus, status, calls };
}

describe("media pause", () => {
  it("pauses only playing players and resumes only those", async () => {
    const { bus, calls } = fakeBus({ spotify: "Playing", vlc: "Paused", mpv: "Stopped" });
    const pauser = createMediaPauser(bus, 0);
    await pauser.setActive(1, true);
    expect(calls).toEqual(["spotify.Pause"]);
    await pauser.setActive(1, false);
    expect(calls).toEqual(["spotify.Pause", "spotify.Play"]);
  });

  it("waits for the last holder before resuming", async () => {
    const { bus, calls } = fakeBus({ spotify: "Playing" });
    const pauser = createMediaPauser(bus, 0);
    await pauser.setActive(1, true);
    await pauser.setActive(2, true);
    await pauser.setActive(1, false);
    expect(calls).toEqual(["spotify.Pause"]);
    await pauser.setActive(2, false);
    expect(calls).toEqual(["spotify.Pause", "spotify.Play"]);
  });

  it("leaves a player alone when the user changed it meanwhile", async () => {
    const { bus, status, calls } = fakeBus({ spotify: "Playing" });
    const pauser = createMediaPauser(bus, 0);
    await pauser.setActive(1, true);
    status.set("spotify", "Stopped");
    await pauser.setActive(1, false);
    expect(calls).toEqual(["spotify.Pause"]);
  });

  it("keeps media paused when a new holder arrives during the resume delay", async () => {
    const { bus, calls } = fakeBus({ spotify: "Playing" });
    const pauser = createMediaPauser(bus, 20);
    await pauser.setActive(1, true);
    const resuming = pauser.setActive(1, false);
    await pauser.setActive(2, true);
    await resuming;
    expect(calls).toEqual(["spotify.Pause"]);
    await pauser.setActive(2, false);
    expect(calls).toEqual(["spotify.Pause", "spotify.Play"]);
  });

  it("keeps toggling other players when one fails", async () => {
    const { bus, calls } = fakeBus({ broken: "Playing", spotify: "Playing" });
    const pauser = createMediaPauser(
      {
        ...bus,
        call: async (player, method) => {
          if (player === "broken") throw new Error("gone");
          await bus.call(player, method);
        },
      },
      0,
    );
    await pauser.setActive(1, true);
    await pauser.setActive(1, false);
    expect(calls).toEqual(["spotify.Pause", "spotify.Play"]);
  });
});
