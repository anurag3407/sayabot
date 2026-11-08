"use client"

import React from "react"
import {
  AlertTriangle,
  Info,
  Lightbulb,
  ShieldAlert,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/format"

export type AlertType = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION"

const ALERT_CONFIG: Record<
  AlertType,
  {
    title: string
    icon: React.ComponentType<{ className?: string }>
    borderClass: string
    bgClass: string
    textClass: string
    iconColor: string
  }
> = {
  NOTE: {
    title: "Note",
    icon: Info,
    borderClass: "border-m-blue/40",
    bgClass: "bg-m-blue/10",
    textClass: "text-m-blue",
    iconColor: "text-m-blue",
  },
  TIP: {
    title: "Tip",
    icon: Lightbulb,
    borderClass: "border-ok/40",
    bgClass: "bg-ok/10",
    textClass: "text-ok",
    iconColor: "text-ok",
  },
  IMPORTANT: {
    title: "Important",
    icon: Sparkles,
    borderClass: "border-m-lilac/40",
    bgClass: "bg-m-lilac/10",
    textClass: "text-m-lilac",
    iconColor: "text-m-lilac",
  },
  WARNING: {
    title: "Warning",
    icon: AlertTriangle,
    borderClass: "border-warn/40",
    bgClass: "bg-warn/10",
    textClass: "text-warn",
    iconColor: "text-warn",
  },
  CAUTION: {
    title: "Caution",
    icon: ShieldAlert,
    borderClass: "border-danger/40",
    bgClass: "bg-danger/10",
    textClass: "text-danger",
    iconColor: "text-danger",
  },
}

/**
 * Checks whether text or React children start with a GitHub-style alert indicator:
 * [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]
 */
export function parseAlert(children: React.ReactNode): {
  isAlert: boolean
  type?: AlertType
  title?: string
  content?: React.ReactNode
} {
  if (!children) return { isAlert: false }

  // Extract raw string if single element or string
  let firstText = ""
  if (typeof children === "string") {
    firstText = children
  } else if (Array.isArray(children)) {
    const first = children[0]
    if (typeof first === "string") {
      firstText = first
    } else if (React.isValidElement(first) && first.props && typeof first.props === "object") {
      const p = first.props as { children?: React.ReactNode }
      if (typeof p.children === "string") {
        firstText = p.children
      }
    }
  } else if (React.isValidElement(children) && children.props && typeof children.props === "object") {
    const p = children.props as { children?: React.ReactNode }
    if (typeof p.children === "string") {
      firstText = p.children
    }
  }

  const match = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)/is.exec(firstText)
  if (!match || !match[1]) {
    return { isAlert: false }
  }

  const type = match[1].toUpperCase() as AlertType
  const inlineAfter = match[2]

  return {
    isAlert: true,
    type,
    title: ALERT_CONFIG[type].title,
    content: inlineAfter ? (
      <>
        <span>{inlineAfter}</span>
        {Array.isArray(children) ? children.slice(1) : null}
      </>
    ) : Array.isArray(children) ? (
      children.slice(1)
    ) : null,
  }
}

export function Callout({
  type = "NOTE",
  title,
  children,
}: {
  type: AlertType
  title?: string
  children?: React.ReactNode
}) {
  const config = ALERT_CONFIG[type] ?? ALERT_CONFIG.NOTE
  const Icon = config.icon

  return (
    <aside
      className={cn(
        "my-3 rounded-xl border-l-4 border px-4 py-3 text-[13px] leading-relaxed transition-all",
        config.borderClass,
        config.bgClass,
      )}
      role="note"
      aria-label={title ?? config.title}
    >
      <div className={cn("flex items-center gap-2 font-medium", config.textClass)}>
        <Icon className={cn("h-4 w-4 shrink-0", config.iconColor)} />
        <span>{title ?? config.title}</span>
      </div>
      <div className="mt-1.5 text-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        {children}
      </div>
    </aside>
  )
}
