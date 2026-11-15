/**
 * One place that hears "a newer website is out", so the service worker and the workspace's
 * version check don't each show their own toast for the same deploy.
 */
const listeners = new Set<() => void>()

/** The workspace's update UI registers here while it is on screen. */
export function onWebUpdate(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reports a newer website. False when nothing on screen shows it, so the caller should. */
export function reportWebUpdate(): boolean {
  if (!listeners.size) return false
  for (const listener of listeners) listener()
  return true
}
