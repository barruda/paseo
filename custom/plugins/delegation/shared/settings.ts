import { defineRpc, defineSettings } from "@getpaseo/plugin";
import {
  DELEGATION_RPC,
  DELEGATION_SETTINGS_ID,
  DelegationReportInputSchema,
  DelegationReportSchema,
  DelegationSettingsSchema,
} from "@getpaseo/protocol/delegation";

export const delegationSettings = defineSettings({
  id: DELEGATION_SETTINGS_ID,
  scope: "host",
  version: 1,
  schema: DelegationSettingsSchema,
});

export const reportRpc = defineRpc({
  name: DELEGATION_RPC.report,
  input: DelegationReportInputSchema,
  output: DelegationReportSchema,
});
