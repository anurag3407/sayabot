type Listener = (demo: boolean) => void

let demoMode = false
const listeners = new Set<Listener>()

export function isDemoMode(): boolean {
  return demoMode
}

export function setDemoMode(next: boolean): void {
  if (demoMode === next) return
  demoMode = next
  for (const listener of listeners) listener(demoMode)
}

export function subscribeDemoMode(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
