import type { OwnedSubscription, SubscriptionObserver } from '@getpaseo/client';
import type { SessionOutboundMessage } from '@getpaseo/protocol/messages';

export function ownedSnapshot<T>(initial: T, onRelease = () => {}) {
  type Snapshot = T & { subscriptionId: string };
  let current: Snapshot = { ...initial, subscriptionId: 'host-assigned' };
  const observers = new Set<SubscriptionObserver<Snapshot>>();
  let released = false;
  const subscription: OwnedSubscription<T> = {
    subscriptionId: current.subscriptionId,
    ready: Promise.resolve(current),
    subscribe(observer) { observers.add(observer); observer.snapshot(current); return () => observers.delete(observer); },
    async release() { if (!released) { released = true; observers.clear(); onRelease(); } },
  };
  return {
    page: { ...initial, subscription },
    snapshot(value: T) { current = { ...value, subscriptionId: 'restored' }; for (const observer of observers) observer.snapshot(current); },
    update(message: SessionOutboundMessage) { for (const observer of observers) observer.update(message); },
    error(error: unknown) { for (const observer of [...observers]) observer.error?.(error); },
  };
}
