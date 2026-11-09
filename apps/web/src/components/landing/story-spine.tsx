"use client"

import { useEffect, useState } from "react"

const CHAPTERS = [
  { id: "mcp", label: "One link" },
  { id: "room", label: "The room" },
  { id: "collab", label: "Together" },
  { id: "how", label: "Turns" },
  { id: "approve", label: "Approval" },
  { id: "harness", label: "Harness" },
  { id: "day", label: "A day" },
  { id: "features", label: "Everything" },
  { id: "computers", label: "Computers" },
  { id: "android", label: "Pocket" },
  { id: "crew", label: "Crew" },
  { id: "compare", label: "Compare" },
  { id: "pricing", label: "Pricing" },
  { id: "download", label: "Download" },
  { id: "faq", label: "FAQ" },
  { id: "start", label: "Start" },
]

/** A fixed chapter index for wide screens. The lit tick is where you are. */
export function StorySpine() {
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting)
        if (visible) setActive(visible.target.id)
      },
      { rootMargin: "-45% 0px -50% 0px" },
    )
    CHAPTERS.forEach(({ id }) => {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    })
    return () => observer.disconnect()
  }, [])

  return (
    <nav aria-label="Chapters" className="sp-rail">
      {CHAPTERS.map((chapter) => (
        <a key={chapter.id} href={`/#${chapter.id}`} className="sp-link" data-active={active === chapter.id} aria-current={active === chapter.id ? "true" : undefined}>
          <i />
          <span>{chapter.label}</span>
        </a>
      ))}
    </nav>
  )
}
