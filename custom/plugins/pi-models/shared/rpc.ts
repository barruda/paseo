import { defineRpc } from "@getpaseo/plugin";
import {
  PI_MODELS_RPC,
  PiModelsReadInputSchema,
  PiModelsReadOutputSchema,
  PiModelsTestInputSchema,
  PiModelsTestOutputSchema,
  PiModelsWriteInputSchema,
  PiModelsWriteOutputSchema,
} from "@getpaseo/protocol/pi-models";

export const readRpc = defineRpc({
  name: PI_MODELS_RPC.read,
  input: PiModelsReadInputSchema,
  output: PiModelsReadOutputSchema,
});

export const writeRpc = defineRpc({
  name: PI_MODELS_RPC.write,
  input: PiModelsWriteInputSchema,
  output: PiModelsWriteOutputSchema,
});

export const testRpc = defineRpc({
  name: PI_MODELS_RPC.test,
  input: PiModelsTestInputSchema,
  output: PiModelsTestOutputSchema,
});
