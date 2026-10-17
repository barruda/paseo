// CUSTOM(cli-dictation): always-on wake dictation outside the app, on the same controller as the
// app's sidebar toggle. Say "wake up", talk, end with "done", and the text is copied.
import fs from "node:fs";
import { Command } from "commander";
import { WakeDictationController, type WakeDictationPhase } from "@getpaseo/client/wake-dictation";
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

interface WakeOptions {
  daemonTarget: DaemonTarget;
  toggle?: boolean;
  copy: boolean;
  notify?: boolean;
}

async function runWake(options: WakeOptions): Promise<void> {
  const notify = createNotifier(options.notify);
  const log = (line: string) =>
    process.stderr.write(`${new Date().toLocaleTimeString()} ${line}\n`);

  const pidFile = speechPidFile("wake");
  if (options.toggle) {
    const pid = readRunningPid(pidFile);
    if (pid !== null) {
      process.kill(pid, "SIGINT");
      return;
    }
  }

  const recorder = spawnRecorder();
  fs.writeFileSync(pidFile, String(process.pid));
  const connecting = connectToDaemon({ target: options.daemonTarget });
  // A failed connection ends listening now instead of on the first utterance.
  connecting.catch(() => recorder.kill("SIGTERM"));

  let failure: Error | null = null;
  // Utterances go through "processing" while they are transcribed; only announce the
  // waiting/recording states the user acts on.
  let shownPhase: WakeDictationPhase | null = null;
  const controller = new WakeDictationController({
    transcribe: async (chunks) => {
      const upload = new DictationUpload(await connecting);
      for (const chunk of chunks) upload.push(chunk);
      const text = await upload.finish();
      log(`Heard: ${text || "(nothing)"}`);
      return text;
    },
    copy: async (text) => {
      process.stdout.write(`${text}\n`);
      if (options.copy) await runQuietly("wl-copy", [], text);
    },
    onPhase: (phase) => {
      if (phase === "processing" || phase === shownPhase) return;
      const first = shownPhase === null;
      shownPhase = phase;
      if (phase === "capturing") {
        log("Recording. End with “done”.");
        notify("Wake dictation", "Recording… end with “done”", 5000);
      } else if (first) {
        log("Listening for “wake up”.");
        notify("Wake dictation on", "Say “wake up” to start");
      } else {
        log("Listening for “wake up”.");
      }
    },
    onCopied: (text) => {
      log(`${options.copy ? "Copied" : "Done"}: ${text}`);
      notify(options.copy ? "Dictation copied" : "Dictation", text);
    },
    onError: (error) => {
      failure = error;
      recorder.kill("SIGTERM");
    },
  });

  const segmenter = new PcmSegmenter();
  let recorderError = "";
  recorder.stderr.on("data", (data: Buffer) => {
    recorderError += data.toString();
  });
  recorder.stdout.on("data", (data: Buffer) => {
    for (const segment of segmenter.push(data)) controller.pushPcm(segment);
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

  try {
    await recorderClosed;
    controller.stop();
    await connecting;
    if (failure) throw failure;
    if (!stopping) throw new Error(`pw-record stopped: ${recorderError.trim() || "no reason"}`);
    log("Stopped.");
    notify("Wake dictation off");
  } catch (error) {
    notify("Wake dictation failed", describeError(error));
    throw error;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    fs.rmSync(pidFile, { force: true });
    await connecting.then((client) => client.close()).catch(() => undefined);
  }
}

export function createWakeCommand(): Command {
  return addDaemonHostOption(
    new Command("wake")
      .description(
        "Listen until stopped; after “wake up”, transcribe until “done” and copy the text",
      )
      .option("--toggle", "Stop the running wake dictation if there is one, otherwise start it")
      .option("--no-copy", "Print the text without copying it to the clipboard")
      .option("--notify", "Show desktop notifications (for keyboard shortcuts)"),
  ).action(
    withGlobalOptions(async (options: WakeOptions, _command: Command) => {
      try {
        await runWake(options);
      } catch (error) {
        process.stderr.write(`Error: ${describeError(error)}\n`);
        process.exitCode = 1;
      }
    }),
  );
}
