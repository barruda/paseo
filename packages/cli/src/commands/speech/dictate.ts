// CUSTOM(cli-dictation): dictation outside the app, transcribed by the daemon's speech engine.
import fs from "node:fs";
import { Command } from "commander";
import { connectToDaemon } from "../../utils/client.js";
import { addDaemonHostOption, withGlobalOptions } from "../../utils/command-options.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import {
  createNotifier,
  describeError,
  DictationUpload,
  PcmSegmenter,
  readRunningPid,
  runQuietly,
  speechPidFile,
  spawnRecorder,
} from "./shared.js";

interface DictateOptions {
  daemonTarget: DaemonTarget;
  toggle?: boolean;
  copy: boolean;
  notify?: boolean;
}

async function runDictate(options: DictateOptions): Promise<void> {
  const notify = createNotifier(options.notify);

  const pidFile = speechPidFile("dictate");
  if (options.toggle) {
    const pid = readRunningPid(pidFile);
    if (pid !== null) {
      process.kill(pid, "SIGINT");
      return;
    }
  }

  // Open the mic first and connect while the user talks; segments wait in `early` until then.
  const startedAt = performance.now();
  const elapsed = () => `${Math.round(performance.now() - startedAt)} ms`;
  const recorder = spawnRecorder();
  fs.writeFileSync(pidFile, String(process.pid));
  const segmenter = new PcmSegmenter();
  const early: string[] = [];
  let upload: DictationUpload | null = null;
  let recorderError = "";
  recorder.stderr.on("data", (data: Buffer) => {
    recorderError += data.toString();
  });
  recorder.stdout.once("data", () => {
    process.stderr.write(`Recording (${elapsed()}). Press Ctrl+C to stop.\n`);
    notify("Dictation", "Recording…");
  });
  recorder.stdout.on("data", (data: Buffer) => {
    for (const segment of segmenter.push(data)) {
      if (upload) upload.push(segment);
      else early.push(segment);
    }
  });
  const recorderClosed = new Promise<void>((resolve, reject) => {
    recorder.once("error", reject);
    recorder.once("close", () => resolve());
  });

  let stopping = false;
  const stop = () => {
    if (stopping) process.exit(130);
    stopping = true;
    recorder.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const connecting = connectToDaemon({ target: options.daemonTarget }).then((client) => {
    process.stderr.write(`Connected to the daemon (${elapsed()}).\n`);
    upload = new DictationUpload(client);
    for (const segment of early.splice(0)) upload.push(segment);
    return client;
  });
  // A failed connection ends the recording now instead of when the user stops it.
  connecting.catch(() => recorder.kill("SIGTERM"));

  try {
    await recorderClosed;
    await connecting;
    if (!stopping) throw new Error(`pw-record stopped: ${recorderError.trim() || "no reason"}`);
    const tail = segmenter.flush();
    if (tail) upload!.push(tail);
    process.stderr.write("Transcribing…\n");
    const text = await upload!.finish();
    if (!text) {
      process.stderr.write("No speech recognized.\n");
      notify("Dictation", "No speech recognized");
      return;
    }
    process.stdout.write(`${text}\n`);
    if (options.copy) await runQuietly("wl-copy", [], text);
    notify(options.copy ? "Dictation copied" : "Dictation", text);
  } catch (error) {
    notify("Dictation failed", describeError(error));
    throw error;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    fs.rmSync(pidFile, { force: true });
    await connecting.then((client) => client.close()).catch(() => undefined);
  }
}

export function createDictateCommand(): Command {
  return addDaemonHostOption(
    new Command("dictate")
      .description(
        "Record from the microphone until stopped, transcribe with the daemon, and copy the text",
      )
      .option("--toggle", "Stop the running dictation if there is one, otherwise start one")
      .option("--no-copy", "Print the text without copying it to the clipboard")
      .option("--notify", "Show desktop notifications (for keyboard shortcuts)"),
  ).action(
    withGlobalOptions(async (options: DictateOptions, _command: Command) => {
      try {
        await runDictate(options);
      } catch (error) {
        process.stderr.write(`Error: ${describeError(error)}\n`);
        process.exitCode = 1;
      }
    }),
  );
}
