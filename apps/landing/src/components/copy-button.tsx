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
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`btn-copy ${className}`}
      aria-label="Copy to clipboard"
      title="Copy install command"
    >
      {copied ? <CheckIcon className="icon-sm" /> : <CopyIcon className="icon-sm" />}
      <span>{copied ? "Copied!" : label}</span>
    </button>
  )
}
