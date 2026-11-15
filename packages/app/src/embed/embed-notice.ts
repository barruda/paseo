// CUSTOM(agent-embed): lets non-React link guards ask the embedded screen to show a toast.
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeEmbedOpenInApp(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyEmbedOpenInApp(): void {
  for (const listener of listeners) listener();
}
