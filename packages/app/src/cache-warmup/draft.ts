// CUSTOM(draft-composer-ready): a draft's flame is stored under the draft's key; the new session
// takes it over when it is created.

import { cacheWarmupAgentKey } from "./model";
import { useCacheWarmupStore } from "./store";

export function moveCacheWarmupDraftToAgent(input: {
  serverId: string;
  draftKey: string;
  agentId: string;
}): void {
  const store = useCacheWarmupStore.getState();
  const draftKey = cacheWarmupAgentKey(input.serverId, input.draftKey);
  if (!store.disabledAgentKeys.includes(draftKey)) return;
  store.setEnabled(draftKey, true);
  store.setEnabled(cacheWarmupAgentKey(input.serverId, input.agentId), false);
}
