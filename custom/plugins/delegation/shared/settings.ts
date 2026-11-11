import { defineSettings } from "@getpaseo/plugin";
import { DELEGATION_SETTINGS_ID, DelegationSettingsSchema } from "@getpaseo/protocol/delegation";

export const delegationSettings = defineSettings({
  id: DELEGATION_SETTINGS_ID,
  scope: "host",
  version: 1,
  schema: DelegationSettingsSchema,
});
