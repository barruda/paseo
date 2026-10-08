import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const READY_PATTERN = /^WARP_BRIDGE_READY (\d+)$/m;
const START_TIMEOUT_MS = 10_000;

const stateSchema = z.object({ port: z.number().int().positive(), token: z.string().min(16) });
type BridgeState = z.output<typeof stateSchema>;

export interface BridgeConfig {
  /** The warp-web-custom checkout: Warp's web build plus `paseo-bridge/`. */
  warpWebDir: string;
  /** System Node. The plugin process runs on Electron's Node, which can't load the bridge's node-pty. */
  nodeBin: string;
  /** Remembers the port and token so restored Warp tabs keep working after a daemon restart. */
  stateFile: string;
}

export function defaultBridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  const home = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  return {
    warpWebDir: env.PASEO_WARP_WEB_DIR ?? path.join(os.homedir(), "projetos", "warp-web-custom"),
    nodeBin: env.PASEO_WARP_NODE ?? "node",
    stateFile: path.join(path.resolve(home), "plugin-data", "warp", "bridge.json"),
  };
}

export function sessionUrl(port: number, token: string, cwd: string): string {
  const url = new URL(`http://127.0.0.1:${port}/`);
  url.searchParams.set("token", token);
  url.searchParams.set("cwd", cwd);
  return url.toString();
}

/** Owns one bridge child process, started on first use and stopped with the plugin. */
export class WarpBridge {
  private child: ChildProcess | null = null;
  private starting: Promise<BridgeState> | null = null;

  constructor(private readonly config: BridgeConfig) {}

  async open(cwd: string): Promise<string> {
    const { port, token } = await this.ensureStarted();
    return sessionUrl(port, token, cwd);
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
    this.starting = null;
  }

  private ensureStarted(): Promise<BridgeState> {
    if (!this.starting) {
      this.starting = this.start().catch((error: unknown) => {
        this.starting = null;
        throw error;
      });
    }
    return this.starting;
  }

  private async start(): Promise<BridgeState> {
    const script = path.join(this.config.warpWebDir, "paseo-bridge", "server.mjs");
    if (!existsSync(script)) {
      throw new Error(`Warp bridge not found at ${script}. Set PASEO_WARP_WEB_DIR.`);
    }
    const saved = await this.readState();
    const token = saved?.token ?? randomBytes(24).toString("hex");
    let port: number;
    try {
      port = await this.spawnBridge(script, saved?.port ?? 0, token);
    } catch (error) {
      // The remembered port can be taken by something else; any free port will do.
      if (!saved) throw error;
      port = await this.spawnBridge(script, 0, token);
    }
    const state = { port, token };
    await this.writeState(state);
    return state;
  }

  private spawnBridge(script: string, port: number, token: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.nodeBin, [script], {
        cwd: path.dirname(script),
        env: {
          ...process.env,
          PORT: String(port),
          WARP_BRIDGE_TOKEN: token,
          WARP_BRIDGE_EXIT_ON_STDIN_CLOSE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      const timer = setTimeout(
        () => fail(new Error("Warp bridge did not start in time")),
        START_TIMEOUT_MS,
      );
      const fail = (error: Error) => {
        clearTimeout(timer);
        child.kill();
        reject(new Error(`${error.message}\n${output.trim()}`.trim()));
      };
      child.once("error", fail);
      child.once("exit", (code) => {
        // A bridge that dies after starting is restarted on the next open.
        if (this.child === child) {
          this.child = null;
          this.starting = null;
        }
        fail(new Error(`Warp bridge exited with code ${code}`));
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        process.stderr.write(chunk);
      });
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        process.stdout.write(chunk);
        const ready = READY_PATTERN.exec(output);
        if (!ready) return;
        clearTimeout(timer);
        this.child = child;
        resolve(Number(ready[1]));
      });
    });
  }

  private async readState(): Promise<BridgeState | null> {
    try {
      return stateSchema.parse(JSON.parse(await readFile(this.config.stateFile, "utf8")));
    } catch {
      return null;
    }
  }

  private async writeState(state: BridgeState): Promise<void> {
    await mkdir(path.dirname(this.config.stateFile), { recursive: true });
    const temp = `${this.config.stateFile}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
    await rename(temp, this.config.stateFile);
  }
}
