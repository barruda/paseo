import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  CRITIC_TIMELINE_KIND,
  CRITIC_TIMELINE_VERSION,
  CriticReviewDataSchema,
} from "@getpaseo/protocol/critic";
import { CriticReviewCard } from "./client/review-card";

// The settings live in the app's composer toggle (packages/app/src/critic); the plugin's client
// side only draws the review rows.
export default function contribute(client: PluginClientContext) {
  return client.addTimelineRenderer({
    kind: CRITIC_TIMELINE_KIND,
    version: CRITIC_TIMELINE_VERSION,
    schema: CriticReviewDataSchema,
    Component: CriticReviewCard,
  });
}
