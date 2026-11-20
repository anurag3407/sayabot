"use client"

import React, { createContext, useContext, useEffect, useState, useTransition } from "react"

export type Theme = "system" | "dark" | "light"

export interface ThemeContextValue {
  theme: Theme
  resolvedTheme: "dark" | "light"
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const STORAGE_KEY = "sayabot-theme"

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function applyTheme(theme: Theme): "dark" | "light" {
  if (typeof document === "undefined") return "dark"
  const root = document.documentElement
  const resolved = theme === "system" ? getSystemTheme() : theme

  if (resolved === "dark") {
    root.classList.add("dark")
    root.classList.remove("light")
    root.setAttribute("data-theme", "dark")
  } else {
    root.classList.add("light")
    root.classList.remove("dark")
    root.setAttribute("data-theme", "light")
  }

  // Update meta theme-color tag if present
  const metaThemeColor = document.querySelector('meta[name="theme-color"]')
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", resolved === "dark" ? "#070907" : "#f5f5f7")
  }

  return resolved
}

export function ThemeScript() {
  const scriptContent = `
(function() {
  try {
    var stored = localStorage.getItem("${STORAGE_KEY}");
    var theme = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;
    var root = document.documentElement;
    if (resolved === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
      root.setAttribute("data-theme", "dark");
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
      root.setAttribute("data-theme", "light");
    }
  } catch (e) {}
})();
`
  return <script dangerouslySetInnerHTML={{ __html: scriptContent }} />
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system")
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("dark")
  const [mounted, setMounted] = useState(false)
  const [, startTransition] = useTransition()

  // Initialize theme from localStorage on mount
  useEffect(() => {
    setMounted(true)
    let saved: Theme = "system"
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === "light" || stored === "dark" || stored === "system") {
        saved = stored
      }
    } catch {
      // fallback to system
    }

    setThemeState(saved)
    const active = applyTheme(saved)
    setResolvedTheme(active)
  }, [])

  // Listen to OS system color scheme changes when theme === "system"
  useEffect(() => {
    if (typeof window === "undefined") return
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

    const handleChange = () => {
      if (theme === "system") {
        const active = applyTheme("system")
        setResolvedTheme(active)
      }
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [theme])

  const setTheme = (newTheme: Theme) => {
    startTransition(() => {
      setThemeState(newTheme)
      try {
        localStorage.setItem(STORAGE_KEY, newTheme)
      } catch {
        // storage disabled
      }
      const active = applyTheme(newTheme)
      setResolvedTheme(active)
    })
  }

  const toggleTheme = () => {
    if (resolvedTheme === "dark") {
      setTheme("light")
    } else {
      setTheme("dark")
    }
  }

  return (
    <ThemeContext.Provider
      value={{
        theme: mounted ? theme : "system",
        resolvedTheme: mounted ? resolvedTheme : "dark",
        setTheme,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    // Graceful fallback for components outside ThemeProvider
    return {
      theme: "system",
      resolvedTheme: "dark",
      setTheme: () => {},
      toggleTheme: () => {},
    }
  }
  return ctx
}
