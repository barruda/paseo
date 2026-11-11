import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  DELEGATION_TIMELINE_KIND,
  DELEGATION_TIMELINE_VERSION,
  DelegationCardDataSchema,
} from "@getpaseo/protocol/delegation";
import { DelegationCard } from "./client/card";

// The card a delegated session gets. The composer icon and its sheet live in the app
// (packages/app/src/delegation), which reads this plugin's settings.
export default function contribute(client: PluginClientContext) {
  return client.addTimelineRenderer({
    kind: DELEGATION_TIMELINE_KIND,
    version: DELEGATION_TIMELINE_VERSION,
    schema: DelegationCardDataSchema,
    Component: DelegationCard,
  });
}
