import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createFileOpener, openFileInSystemBrowser } from "./file-opener";

import { createExternalUrlOpener } from "./opener";

describe("desktop opener", () => {
  it("passes a canonical web URL to its external owner", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });

    await open("https://example.com/docs#install");

    expect(opened).toEqual(["https://example.com/docs#install"]);
  });

  it("does not hand non-web or relative URLs to the external owner", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });

    for (const input of [
      "file:///private/data",
      "javascript:alert(1)",
      "paseo://settings",
      "/docs",
      null,
    ]) {
      await expect(open(input)).rejects.toThrow("Only HTTP(S) URLs can open externally.");
    }

    expect(opened).toEqual([]);
  });
});

// CUSTOM(open-file-externally): exercise paths as data, including shell metacharacters.
describe("local file opener", () => {
  it.skipIf(process.platform !== "linux")(
    "launches the configured browser desktop entry with an encoded file URL",
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "paseo-browser-launch-"));
      const bin = path.join(directory, "bin");
      const data = path.join(directory, "data");
      const argsFile = path.join(directory, "args.json");
      await mkdir(bin);
      await mkdir(path.join(data, "applications"), { recursive: true });
      const desktopFile = path.join(data, "applications", "test-browser.desktop");
      await writeFile(desktopFile, "[Desktop Entry]\n");
      await writeFile(
        path.join(bin, "xdg-settings"),
        "#!/bin/sh\nprintf 'test-browser.desktop\\n'\n",
        { mode: 0o755 },
      );
      const gioScript = `#!${process.execPath}
require('node:fs').writeFileSync(process.env.PASEO_TEST_BROWSER_ARGS, JSON.stringify(process.argv.slice(2)));
`;
      await writeFile(path.join(bin, "gio"), gioScript, { mode: 0o755 });
      vi.stubEnv("PATH", bin);
      vi.stubEnv("XDG_DATA_HOME", data);
      vi.stubEnv("XDG_DATA_DIRS", data);
      vi.stubEnv("PASEO_TEST_BROWSER_ARGS", argsFile);
      try {
        const filePath = path.join(directory, "report # é $(echo unsafe).html");
        await openFileInSystemBrowser(filePath, vi.fn());
        expect(JSON.parse(await readFile(argsFile, "utf8"))).toEqual([
          "launch",
          desktopFile,
          pathToFileURL(filePath).href,
        ]);
        await rm(desktopFile);
        await expect(openFileInSystemBrowser(filePath, vi.fn())).rejects.toThrow(
          "desktop entry could not be found",
        );
      } finally {
        vi.unstubAllEnvs();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("uses the OS association or explicit browser for the same literal file path", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "paseo-open-file-"));
    const filePath = path.join(directory, "a # é $(echo unsafe).html");
    await writeFile(filePath, "<h1>Local file</h1>");
    const openPath = vi.fn().mockResolvedValue("");
    const browserApplication = vi.fn();
    const openBrowser = vi.fn().mockResolvedValue(undefined);
    const open = createFileOpener({ openPath, browserApplication }, openBrowser);
    try {
      await open({ path: filePath, mode: "default" });
      expect(openPath).toHaveBeenCalledWith(filePath);
      expect(openBrowser).not.toHaveBeenCalled();
      await open({ path: filePath, mode: "browser" });
      expect(openBrowser).toHaveBeenCalledWith(filePath, browserApplication);
      openPath.mockResolvedValue("No application is associated with this file");
      await expect(open({ path: filePath, mode: "default" })).rejects.toThrow("No application");
      openBrowser.mockRejectedValue(new Error("Browser could not start"));
      await expect(open({ path: filePath, mode: "browser" })).rejects.toThrow(
        "Browser could not start",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  // CUSTOM(chat-file-actions)
  it("reveals a file in the system file manager", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "paseo-open-file-"));
    const filePath = path.join(directory, "run.sh");
    await writeFile(filePath, "echo hi");
    const openPath = vi.fn();
    const showItemInFolder = vi.fn();
    const open = createFileOpener({ openPath, browserApplication: vi.fn(), showItemInFolder });
    try {
      await open({ path: filePath, mode: "reveal" });
      expect(showItemInFolder).toHaveBeenCalledWith(filePath);
      expect(openPath).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses malformed inputs and missing files before launching anything", async () => {
    const openPath = vi.fn();
    const openBrowser = vi.fn();
    const open = createFileOpener({ openPath, browserApplication: vi.fn() }, openBrowser);
    for (const input of [
      null,
      { path: "relative.html", mode: "default" },
      { path: "https://example.com", mode: "browser" },
      { path: "/tmp/file\0.html", mode: "default" },
      { path: "/tmp/file.html", mode: "other" },
      { path: path.join(tmpdir(), "paseo-nonexistent", "file.html"), mode: "browser" },
    ]) {
      await expect(open(input)).rejects.toThrow();
    }
    expect(openPath).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });
});
