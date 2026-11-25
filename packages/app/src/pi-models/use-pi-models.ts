import { useCallback, useEffect, useState } from "react";
import {
  PI_MODELS_RPC,
  PiModelsReadOutputSchema,
  PiModelsTestOutputSchema,
  PiModelsWriteOutputSchema,
  type PiModelsReadOutput,
  type PiModelsTestOutput,
} from "@getpaseo/protocol/pi-models";
import type { InstalledPlugin } from "@/plugins/types";
import { toErrorMessage } from "@/utils/error-messages";
import { parsePiModels, serializePiModels, type PiModelsDocument } from "./document";

// CUSTOM(pi-models): loads Pi's models.json through the `pi-models` plugin and saves whole-file
// edits back. A save carries the revision it was based on, so an edit made on disk meanwhile is
// reloaded instead of overwritten.

export type PiModelsLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      file: PiModelsReadOutput;
      /** null when the file is not JSON the editor can read; the raw editor still opens. */
      doc: PiModelsDocument | null;
      parseError: string | null;
    };

function toReady(file: PiModelsReadOutput): PiModelsLoad {
  try {
    return { status: "ready", file, doc: parsePiModels(file.text), parseError: null };
  } catch (error) {
    return { status: "ready", file, doc: null, parseError: toErrorMessage(error) };
  }
}

export interface PiModelsController {
  load: PiModelsLoad;
  reload: () => Promise<void>;
  /** Saves the whole file. Resolves to an error message, or null once saved. */
  saveText: (text: string) => Promise<string | null>;
  saveDoc: (doc: PiModelsDocument) => Promise<string | null>;
  test: (input: {
    provider: string;
    model: string;
    thinking?: string;
  }) => Promise<PiModelsTestOutput>;
}

export function usePiModels(plugin: InstalledPlugin, onSaved: () => void): PiModelsController {
  const [load, setLoad] = useState<PiModelsLoad>({ status: "loading" });

  const reload = useCallback(async () => {
    try {
      const file = PiModelsReadOutputSchema.parse(await plugin.invoke(PI_MODELS_RPC.read, {}));
      setLoad(toReady(file));
    } catch (error) {
      setLoad({ status: "error", message: toErrorMessage(error) });
    }
  }, [plugin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const baseRevision = load.status === "ready" ? load.file.revision : null;

  const saveText = useCallback(
    async (text: string): Promise<string | null> => {
      if (baseRevision === null) return "models.json is not loaded yet.";
      try {
        const result = PiModelsWriteOutputSchema.parse(
          await plugin.invoke(PI_MODELS_RPC.write, { text, baseRevision }),
        );
        if (result.status === "invalid") return result.message;
        setLoad(toReady(result.file));
        if (result.status === "conflict")
          return "models.json changed on disk since it was loaded. It was reloaded; make the edit again.";
        onSaved();
        return null;
      } catch (error) {
        return toErrorMessage(error);
      }
    },
    [baseRevision, onSaved, plugin],
  );

  const saveDoc = useCallback(
    (doc: PiModelsDocument) => saveText(serializePiModels(doc)),
    [saveText],
  );

  const test = useCallback(
    async (input: { provider: string; model: string; thinking?: string }) =>
      PiModelsTestOutputSchema.parse(await plugin.invoke(PI_MODELS_RPC.test, input)),
    [plugin],
  );

  return { load, reload, saveText, saveDoc, test };
}
