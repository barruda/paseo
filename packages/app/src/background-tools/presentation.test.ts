// CUSTOM(background-tools)
import { describe, expect, test } from "vitest";
import {
  backgroundToolCopyText,
  backgroundToolKindLabel,
  buildBackgroundToolsSegments,
  hasBackgroundTools,
  hasWaitingBackgroundTools,
  hasWakingBackgroundTools,
  isBackgroundToolCallActive,
  isWaitingBackgroundTool,
  withWaitingBackgroundTools,
} from "./presentation";

describe("background tools presentation", () => {
  test("splits the chip into running monitors and plain shells", () => {
    const shell = { id: "s", kind: "shell", description: "dev" };
    const monitor = { id: "m", kind: "monitor", description: "watch" };
    expect(buildBackgroundToolsSegments([shell])).toEqual([{ bucket: null, text: "1 shell" }]);
    expect(buildBackgroundToolsSegments([monitor, { ...monitor, id: "m2" }])).toEqual([
      { bucket: "running", text: "2 monitors" },
    ]);
    expect(
      buildBackgroundToolsSegments([
        shell,
        monitor,
        { ...shell, id: "s2" },
        { ...shell, kind: "other" },
      ]),
    ).toEqual([
      { bucket: "running", text: "1 monitor" },
      { bucket: null, text: "3 shells" },
    ]);
    expect(buildBackgroundToolsSegments([])).toEqual([]);
  });

  test("only monitors count as waking work", () => {
    expect(hasWakingBackgroundTools(undefined)).toBe(false);
    expect(hasWakingBackgroundTools([{ id: "a", kind: "shell", description: "x" }])).toBe(false);
    expect(
      hasWakingBackgroundTools([
        { id: "a", kind: "shell", description: "x" },
        { id: "b", kind: "monitor", description: "y" },
      ]),
    ).toBe(true);
  });

  test("labels each kind", () => {
    expect(backgroundToolKindLabel("shell")).toBe("Shell");
    expect(backgroundToolKindLabel("monitor")).toBe("Monitor");
    expect(backgroundToolKindLabel("future-kind")).toBe("Tool");
  });

  test("copies the command, or the description when there is none", () => {
    expect(
      backgroundToolCopyText({
        id: "a",
        kind: "shell",
        description: "dev",
        command: "npm run dev",
      }),
    ).toBe("npm run dev");
    expect(backgroundToolCopyText({ id: "a", kind: "shell", description: "dev" })).toBe("dev");
    expect(
      backgroundToolCopyText({ id: "a", kind: "shell", description: "dev", command: "  " }),
    ).toBe("dev");
  });

  test("detects tools", () => {
    expect(hasBackgroundTools(undefined)).toBe(false);
    expect(hasBackgroundTools([])).toBe(false);
    expect(hasBackgroundTools([{ id: "a", kind: "shell", description: "x" }])).toBe(true);
  });

  describe("waiting shells", () => {
    const shell = (command: string, description = "task") => ({
      id: "s",
      kind: "shell",
      description,
      command,
    });
    const pollLoop = shell(
      `cd /home/bruno/projetos/paseo; R="env -u PASEO_AGENT_ID npx tsx /x/pa-rpc.mts"; until $R workboard.assistant.history.list '{"limit":1}' 2>/dev/null | grep -q done; do sleep 10; done; $R workboard.assistant.history.list '{"limit":12}'`,
      "Wait until the chat-created task settles, then show results",
    );
    const daemon = shell(
      "cd /home/bruno/projetos/paseo; env -u PASEO_AGENT_ID PASEO_HOME=/x PASEO_LISTEN=127.0.0.1:6790 ./scripts/dev-daemon.sh > /x/daemon.log 2>&1",
      "Restart isolated dev daemon on port 6790",
    );

    test("recognises poll loops and sleeps", () => {
      expect(isWaitingBackgroundTool(pollLoop)).toBe(true);
      expect(isWaitingBackgroundTool(shell("sleep 600"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("sleep 75; check"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("build && sleep 5"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("gh run watch 123"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("gh pr checks 4 --watch"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("tail --pid=12 -f log"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("sleep 1 & wait"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("while true; do sleep 2; done"))).toBe(true);
    });

    test("recognises a waiting description", () => {
      expect(isWaitingBackgroundTool(shell("./check.sh", "  Waiting for CI"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("./check.sh", "Aguardando build"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("./check.sh", "Run check"))).toBe(false);
    });

    // 2026-11-21: an agent ended its turn on a long update script writing a log and a
    // `tail -f | grep` watching it; the tab showed it done.
    const updateJob = shell(
      `cd /home/bruno/projetos/paseo && /home/bruno/projetos/paseo/.git/custom-update.sh --continue --install > /home/bruno/uprojects/tmp/continue.log 2>&1; echo "EXIT $?" >> /home/bruno/uprojects/tmp/continue.log`,
      "Commit merge, verify, build and install the update",
    );
    const logWatcher = shell(
      `tail -n +1 -f /home/bruno/uprojects/tmp/continue.log | grep -E --line-buffered '^==>|^EXIT|FAIL|Error|error:'`,
      "update script steps and failures",
    );

    test("recognises a finite job and the log watcher that follows it", () => {
      expect(isWaitingBackgroundTool(updateJob)).toBe(true);
      expect(isWaitingBackgroundTool(logWatcher)).toBe(true);
      expect(buildBackgroundToolsSegments([updateJob, { ...logWatcher, id: "s2" }])).toEqual([
        { bucket: "waiting", text: "2 waiting" },
      ]);
      expect(hasWaitingBackgroundTools([updateJob])).toBe(true);
    });

    test("recognises finite jobs by exit code, log file or description", () => {
      expect(isWaitingBackgroundTool(shell("./long.sh; echo $? > /x/rc"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("npm run build > /x/build.log 2>&1"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("npx vitest run a.test.ts &> out.txt"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("make install | tee -a make.log"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("npx vite build > vite.log"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("./ci.sh", "Run the tests"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("./go.sh", "Compilar e testar o app"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("./go.sh", "Deploy to staging"))).toBe(true);
      // Not enough on its own: no log file, a /dev/null sink, a non-work description.
      expect(isWaitingBackgroundTool(shell("npm run build"))).toBe(false);
      expect(isWaitingBackgroundTool(shell("npm run build > /dev/null 2>&1"))).toBe(false);
      expect(isWaitingBackgroundTool(shell("./run.sh > run.log 2>&1", "Run it"))).toBe(false);
    });

    test("recognises a filtered log watcher", () => {
      expect(isWaitingBackgroundTool(shell("tail -f b.log | grep --line-buffered x"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("tail -F b.log | grep -E 'EXIT|FAIL'"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("tail --follow b.log | rg error"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("tail -f b.log | grep foo"))).toBe(false);
      expect(
        isWaitingBackgroundTool(shell("tail -f b.log | grep --line-buffered x & npm run dev")),
      ).toBe(false);
    });

    test("leaves services and non-shells alone", () => {
      expect(isWaitingBackgroundTool(shell("npm run dev > dev.log 2>&1", "Build and serve"))).toBe(
        false,
      );
      expect(isWaitingBackgroundTool(shell("npx vite > vite.log"))).toBe(false);
      expect(isWaitingBackgroundTool(shell("python3 -m http.server", "Serve the build"))).toBe(
        false,
      );
      expect(isWaitingBackgroundTool(shell("./srv.sh", "Start the test server"))).toBe(false);
      expect(isWaitingBackgroundTool(shell("npm run test -- --watch > t.log"))).toBe(false);
      expect(isWaitingBackgroundTool(shell("docker compose up > up.log", "Build images"))).toBe(
        false,
      );
      expect(isWaitingBackgroundTool(daemon)).toBe(false);
      expect(isWaitingBackgroundTool(shell("npm run dev"))).toBe(false);
      expect(isWaitingBackgroundTool(shell("npx vite --watch"))).toBe(false);
      expect(isWaitingBackgroundTool(shell("tail -f app.log"))).toBe(false);
      expect(isWaitingBackgroundTool(shell("docker compose up"))).toBe(false);
      expect(isWaitingBackgroundTool(shell("sleep 5; npm run dev"))).toBe(false);
      expect(isWaitingBackgroundTool(shell("", "Wait for dev server"))).toBe(true);
      expect(isWaitingBackgroundTool(shell("npm run dev", "Wait for dev server"))).toBe(false);
      expect(isWaitingBackgroundTool({ id: "m", kind: "monitor", description: "waiting" })).toBe(
        false,
      );
    });

    test("splits the chip into running, waiting and plain segments", () => {
      expect(buildBackgroundToolsSegments([pollLoop])).toEqual([
        { bucket: "waiting", text: "1 waiting" },
      ]);
      expect(
        buildBackgroundToolsSegments([
          pollLoop,
          { ...pollLoop, id: "w2" },
          daemon,
          { id: "m", kind: "monitor", description: "watch" },
        ]),
      ).toEqual([
        { bucket: "running", text: "1 monitor" },
        { bucket: "waiting", text: "2 waiting" },
        { bucket: null, text: "1 shell" },
      ]);
    });

    test("detects waiting tools", () => {
      expect(hasWaitingBackgroundTools(undefined)).toBe(false);
      expect(hasWaitingBackgroundTools([daemon])).toBe(false);
      expect(hasWaitingBackgroundTools([daemon, pollLoop])).toBe(true);
    });

    test("lifts only a finished tab to waiting", () => {
      expect(withWaitingBackgroundTools("done", true)).toBe("waiting");
      expect(withWaitingBackgroundTools("attention", true)).toBe("waiting");
      expect(withWaitingBackgroundTools("running", true)).toBe("running");
      expect(withWaitingBackgroundTools("needs_input", true)).toBe("needs_input");
      expect(withWaitingBackgroundTools("failed", true)).toBe("failed");
      expect(withWaitingBackgroundTools(null, true)).toBeNull();
      expect(withWaitingBackgroundTools("done", false)).toBe("done");
    });
  });

  // CUSTOM(shell-row-loading)
  test("a tool call is active while the background task it started is live", () => {
    const build = { id: "t1", kind: "shell", description: "Build", toolCallId: "toolu_build" };
    const legacy = { id: "t2", kind: "shell", description: "From an older daemon" };
    expect(isBackgroundToolCallActive([build, legacy], "toolu_build")).toBe(true);
    expect(isBackgroundToolCallActive([legacy], "toolu_build")).toBe(false);
    expect(isBackgroundToolCallActive([], "toolu_build")).toBe(false);
    expect(isBackgroundToolCallActive(undefined, "toolu_build")).toBe(false);
    expect(isBackgroundToolCallActive([build], undefined)).toBe(false);
  });
});
