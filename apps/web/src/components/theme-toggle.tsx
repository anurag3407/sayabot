"use client"

import React from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme, type Theme } from "./theme-provider"
import { cn } from "@/lib/format"

interface ThemeToggleProps {
  variant?: "icon" | "segmented" | "menu-item"
  className?: string
  showLabel?: boolean
}

export function ThemeToggle({
  variant = "icon",
  className,
  showLabel = false,
}: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme()

  if (variant === "segmented") {
    const options: { value: Theme; label: string; icon: typeof Sun }[] = [
      { value: "system", label: "System", icon: Monitor },
      { value: "light", label: "Light", icon: Sun },
      { value: "dark", label: "Dark", icon: Moon },
    ]

    return (
      <div
        className={cn(
          "inline-flex items-center rounded-xl border border-line bg-raised p-1 text-xs",
          className,
        )}
        role="radiogroup"
        aria-label="Theme mode"
      >
        {options.map((opt) => {
          const active = theme === opt.value
          const Icon = opt.icon
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(opt.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-all",
                active
                  ? "bg-panel text-text shadow-sm"
                  : "text-muted hover:text-text",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{opt.label}</span>
            </button>
          )
        })}
      </div>
    )
  }

  if (variant === "menu-item") {
    return (
      <div className={cn("flex items-center justify-between px-2.5 py-1.5 text-xs text-muted", className)}>
        <span className="flex items-center gap-2">
          {resolvedTheme === "dark" ? (
            <Moon className="h-4 w-4 text-faint" />
          ) : (
            <Sun className="h-4 w-4 text-faint" />
          )}
          <span>Theme</span>
        </span>
        <div className="flex items-center gap-1 rounded-lg border border-line bg-raised/70 p-0.5">
          <button
            type="button"
            title="System theme"
            aria-label="Use system theme"
            onClick={() => setTheme("system")}
            className={cn(
              "rounded-md p-1 transition-colors",
              theme === "system" ? "bg-panel text-accent shadow-xs" : "text-faint hover:text-text",
            )}
          >
            <Monitor className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Light theme"
            aria-label="Use light theme"
            onClick={() => setTheme("light")}
            className={cn(
              "rounded-md p-1 transition-colors",
              theme === "light" ? "bg-panel text-accent shadow-xs" : "text-faint hover:text-text",
            )}
          >
            <Sun className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Dark theme"
            aria-label="Use dark theme"
            onClick={() => setTheme("dark")}
            className={cn(
              "rounded-md p-1 transition-colors",
              theme === "dark" ? "bg-panel text-accent shadow-xs" : "text-faint hover:text-text",
            )}
          >
            <Moon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  // Default: icon button
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={
        resolvedTheme === "dark"
          ? "Switch to light mode"
          : "Switch to dark mode"
      }
      aria-label="Toggle theme"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-panel p-2 text-muted transition-colors hover:bg-raised hover:text-text",
        className,
      )}
    >
      {resolvedTheme === "dark" ? (
        <Sun className="h-4 w-4 text-amber" />
      ) : (
        <Moon className="h-4 w-4 text-accent" />
      )}
      {showLabel && (
        <span className="text-xs font-medium">
          {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
        </span>
      )}
    </button>
  )
}
