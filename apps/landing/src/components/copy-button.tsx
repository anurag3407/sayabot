"use client"

import { useState } from "react"
import { CheckIcon, CopyIcon } from "./icons"

export function CopyButton({
  text,
  label = "Copy",
  className = "",
}: {
  text: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        copyFallback(text)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      try {
        copyFallback(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // ignore
      }
    }
  }

  function copyFallback(val: string) {
    const el = document.createElement("textarea")
    el.value = val
    el.setAttribute("readonly", "")
    el.style.position = "fixed"
    el.style.left = "-9999px"
    el.style.opacity = "0"
    document.body.appendChild(el)
    el.select()
    document.execCommand("copy")
    document.body.removeChild(el)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`btn-copy ${copied ? "is-copied" : ""} ${className}`.trim()}
      aria-label="Copy to clipboard"
      title="Copy install command"
    >
      {copied ? <CheckIcon className="btn-copy-icon" /> : <CopyIcon className="btn-copy-icon" />}
      <span>{copied ? "Copied!" : label}</span>
    </button>
  )
}
