"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

const ITEMS =
  '[role="menuitem"], [role="menuitemradio"], [role="option"], a[href], button:not([disabled]), input:not([disabled])'

/** Choosing one of these closes the menu; typing in a field inside it does not. */
const CLOSES = '[role="menuitem"], [role="menuitemradio"], a[href], button'

/**
 * A <details> dropdown that closes on Escape and on a click outside it, with arrow-key movement
 * between its items. Listeners only exist while it is open: the sidebar renders one per chat, and
 * keeping them all attached made every click and key press fan out across the whole list.
 */
export function DetailsMenu({
  summary,
  summaryClassName,
  summaryLabel,
  className,
  children,
}: {
  summary: ReactNode
  summaryClassName?: string
  summaryLabel?: string
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const openedByKey = useRef(false)

  useEffect(() => {
    const element = ref.current
    if (!open || !element) return
    const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])
    if (openedByKey.current) items()[0]?.focus()
    openedByKey.current = false

    const close = (refocus: boolean) => {
      element.open = false
      if (refocus) element.querySelector("summary")?.focus()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) close(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close(true)
        return
      }
      if (!element.contains(document.activeElement)) return
      const list = items()
      if (!list.length) return
      const index = list.indexOf(document.activeElement as HTMLElement)
      const move = (next: number) => {
        event.preventDefault()
        list[(next + list.length) % list.length]?.focus()
      }
      if (event.key === "ArrowDown") move(index + 1)
      else if (event.key === "ArrowUp") move(index < 0 ? list.length - 1 : index - 1)
      else if (event.key === "Home") move(0)
      else if (event.key === "End") move(list.length - 1)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return (
    <details
      ref={ref}
      className={className}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        className={summaryClassName}
        aria-label={summaryLabel}
        title={summaryLabel}
        aria-haspopup="menu"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown")
            openedByKey.current = true
          if (event.key === "ArrowDown" && ref.current && !ref.current.open) {
            event.preventDefault()
            ref.current.open = true
          }
        }}
      >
        {summary}
      </summary>
      <div
        ref={panel}
        onClick={(event) => {
          // A click on an item closes the menu; a click on the panel's padding does not.
          if (ref.current && (event.target as HTMLElement).closest(CLOSES)) ref.current.open = false
        }}
      >
        {open ? children : null}
      </div>
    </details>
  )
}
