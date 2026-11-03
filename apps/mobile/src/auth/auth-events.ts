export type AuthLostListener = () => void;

const listeners = new Set<AuthLostListener>();

/** Subscribe to "the session could not be refreshed and was cleared". */
export function onAuthLost(listener: AuthLostListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitAuthLost(): void {
  listeners.forEach((listener) => listener());
}
