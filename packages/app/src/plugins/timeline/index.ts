import { useMemo } from "react";
import { useInstalledPlugins } from "../registry";
import {
  transformTimelineItem,
  type TimelineItemTransform,
  type TimelineTransformAgent,
} from "./model";

export type { InstalledPluginTimelineItem, TimelineItemTransform } from "./model";
export { PluginTimelineItemView } from "./view";

export function useInstalledTimelineTransform(
  serverId: string,
  // CUSTOM(timeline-transformer-agent): the chat's agent, passed on to each transformer. Keep the
  // object stable: a new one is a new transform, which reprojects the whole timeline.
  agent?: TimelineTransformAgent,
): TimelineItemTransform {
  const installed = useInstalledPlugins();
  const plugins = useMemo(
    () => installed.filter((plugin) => plugin.serverId === serverId),
    [installed, serverId],
  );
  return useMemo(
    () => (input) => transformTimelineItem({ ...input, plugins, agent }),
    [plugins, agent],
  );
}
