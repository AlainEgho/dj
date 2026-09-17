type Listener = () => void;
const listeners = new Set<Listener>();

/** Short click on the stage (not a drag) toggles the overlay chrome. */
export function emitStageTap() {
  listeners.forEach((fn) => fn());
}

export function onStageTap(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
