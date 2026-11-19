"use client"

import { useEffect } from "react"

interface TabTitleProps {
  originalTitle?: string
}

export function TabTitle({
  originalTitle = "Sayabot · Remote AI agents that keep working while you're away",
}: TabTitleProps) {
  useEffect(() => {
    let timeout: NodeJS.Timeout

    const handleVisibilityChange = () => {
      if (document.hidden) {
        document.title = "⚡ Still working while you're away... | Sayabot"
      } else {
        document.title = "👋 Welcome back! | Sayabot"
        timeout = setTimeout(() => {
          document.title = originalTitle
        }, 1500)
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      clearTimeout(timeout)
    }
  }, [originalTitle])

  return null
}
