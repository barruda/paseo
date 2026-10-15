// CUSTOM(open-file-externally): open local files without interpreting paths as shell commands.
import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const execute = promisify(execFile);
const FileOpenInput = z.object({
  path: z
    .string()
    .min(1)
    .refine((value) => path.isAbsolute(value) && !value.includes("\0")),
  mode: z.enum(["browser", "default"]),
});

interface FileOpenerOwner {
  openPath(filePath: string): Promise<string>;
  browserApplication(): Promise<string>;
}

export function createFileOpener(owner: FileOpenerOwner, openBrowser = openFileInSystemBrowser) {
  return async (input: unknown): Promise<void> => {
    const candidate = FileOpenInput.parse(input);
    await access(candidate.path);
    if (candidate.mode === "browser") {
      await openBrowser(candidate.path, owner.browserApplication);
      return;
    }
    const error = await owner.openPath(candidate.path);
    if (error) throw new Error(error);
  };
}

export async function openFileInSystemBrowser(
  filePath: string,
  browserApplication: () => Promise<string>,
): Promise<void> {
  const url = pathToFileURL(filePath).href;
  if (process.platform === "linux") {
    const { stdout } = await execute("xdg-settings", ["get", "default-web-browser"], {
      timeout: 15_000,
    });
    const desktopName = stdout.trim();
    if (!desktopName.endsWith(".desktop") || path.basename(desktopName) !== desktopName) {
      throw new Error("No default browser configured in desktop settings");
    }
    const dataHome = process.env.XDG_DATA_HOME || path.join(homedir(), ".local/share");
    const dataDirs = process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share";
    for (const directory of [dataHome, ...dataDirs.split(":")]) {
      const desktopFile = path.join(directory, "applications", desktopName);
      try {
        await access(desktopFile);
      } catch {
        continue;
      }
      await execute("gio", ["launch", desktopFile, url], { timeout: 15_000 });
      return;
    }
    throw new Error("Default browser desktop entry could not be found");
  }
  const application = await browserApplication();
  if (!application) throw new Error("No default browser configured in desktop settings");
  if (process.platform === "darwin") {
    await execute("/usr/bin/open", ["-a", application, url], { timeout: 15_000 });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(application, [url], { detached: true, stdio: "ignore", shell: false });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
