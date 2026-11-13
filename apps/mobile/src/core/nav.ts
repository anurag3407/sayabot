import { createNavigationContainerRef } from "@react-navigation/native"

/** Lets notifications, shortcuts and shares open screens from outside React components. */
export const navigationRef = createNavigationContainerRef()

const pending: Array<() => void> = []

export function navigateWhenReady(name: string, params?: object) {
  const go = () => (navigationRef.navigate as unknown as (n: string, p?: object) => void)(name, params)
  if (navigationRef.isReady()) go()
  else pending.push(go)
}

export function flushPendingNavigation() {
  while (pending.length) pending.shift()!()
}
