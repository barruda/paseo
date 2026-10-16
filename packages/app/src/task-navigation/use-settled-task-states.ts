// CUSTOM(task-state-settle): the sidebar shows each task's state once it has held for a second.
import { useEffect, useState } from "react";
import {
  EMPTY_TASK_STATE_SETTLING,
  settleTaskStates,
  taskKey,
  taskState,
  type TaskAgent,
  type TaskState,
} from "./model";

function liveTaskStates(agents: readonly TaskAgent[]): Map<string, TaskState> {
  return new Map(agents.map((agent) => [taskKey(agent.serverId, agent.id), taskState(agent)]));
}

export function useSettledTaskStates(agents: readonly TaskAgent[]): ReadonlyMap<string, TaskState> {
  const [tick, setTick] = useState(0);
  const [settled, setSettled] = useState(() => ({
    agents,
    tick,
    ...settleTaskStates(EMPTY_TASK_STATE_SETTLING, liveTaskStates(agents), Date.now()),
  }));
  let current = settled;
  if (settled.agents !== agents || settled.tick !== tick) {
    current = {
      agents,
      tick,
      ...settleTaskStates(settled.settling, liveTaskStates(agents), Date.now()),
    };
    setSettled(current);
  }
  useEffect(() => {
    if (current.wakeAt === null) return;
    const timer = setTimeout(
      () => setTick((value) => value + 1),
      Math.max(0, current.wakeAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [current]);
  return current.settling.shown;
}
