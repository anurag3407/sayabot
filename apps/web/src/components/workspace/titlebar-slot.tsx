"use client"

import { createContext, useContext, type ReactNode } from "react"
import { createPortal } from "react-dom"

/** Where pages put their own buttons in the workspace title bar, next to the model picker. */
export const TitlebarSlotContext = createContext<HTMLElement | null>(null)

export function useTitlebarSlot(): HTMLElement | null {
  return useContext(TitlebarSlotContext)
}

/** Renders its children in the title bar when there is one, otherwise right where it is. */
export function TitlebarActions({
  children,
  fallback = true,
}: {
  children: ReactNode
  /** When false, nothing renders without a title bar (the page shows the buttons elsewhere). */
  fallback?: boolean
}) {
  const slot = useTitlebarSlot()
  if (slot) return createPortal(children, slot)
  return fallback ? <>{children}</> : null
}
