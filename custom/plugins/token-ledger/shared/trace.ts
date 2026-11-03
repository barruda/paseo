// CUSTOM(token-ledger-trace): find a turn's trace in a local MLflow server.
import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';

export const TraceLookupSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('found'), url: z.string() }),
  z.object({ status: z.literal('missing') }),
  z.object({ status: z.literal('disabled') }),
  z.object({ status: z.literal('error'), message: z.string() }),
]);
export type TraceLookup = z.infer<typeof TraceLookupSchema>;

export const ledgerTrace = defineRpc({
  name: 'ledger.trace',
  input: z.object({ sessionId: z.string(), startedAt: z.string() }),
  output: TraceLookupSchema,
});
