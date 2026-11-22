"use client"

import { useState } from "react"
import { ChevronRight, FileCode, Folder, GitCompare } from "lucide-react"
import { cn } from "@/lib/format"
import {
  type ChangedFileStat,
  type ChangedFilesSummary,
  formatDiffNumber,
} from "@/lib/chat-tool-presenter"

export function ChangedFilesCard({
  summary,
  onOpenDiff,
  className,
}: {
  summary: ChangedFilesSummary
  onOpenDiff?: (path: string) => void
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const { files, totalFiles, totalAdditions, totalDeletions } = summary

  if (totalFiles === 0) return null

  // Group files by directory
  const directories = new Map<string, ChangedFileStat[]>()
  for (const file of files) {
    const dir = file.dir || "."
    const list = directories.get(dir) || []
    list.push(file)
    directories.set(dir, list)
  }

  return (
    <div
      data-testid="changed-files-card"
      className={cn(
        "mt-3 overflow-hidden rounded-lg border border-border/70 bg-panel/70 text-xs transition-colors",
        className,
      )}
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2 font-medium text-text">
          <span>
            {totalFiles} changed {totalFiles === 1 ? "file" : "files"}
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-2xs tabular-nums">
            {totalAdditions > 0 ? (
              <span className="text-emerald-400">+{formatDiffNumber(totalAdditions)}</span>
            ) : null}
            {totalDeletions > 0 ? (
              <span className="text-rose-400">-{formatDiffNumber(totalDeletions)}</span>
            ) : totalAdditions > 0 ? (
              <span className="text-muted-foreground">-0</span>
            ) : null}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {onOpenDiff ? (
            <button
              type="button"
              onClick={() => onOpenDiff(files[0]?.path || "")}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-2xs font-medium text-muted hover:bg-raised hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-500"
            >
              <GitCompare className="h-3 w-3" />
              <span>Open diff</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 rounded p-1 text-muted hover:bg-raised hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-500"
            title={expanded ? "Collapse files" : "Expand files"}
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-90")}
            />
          </button>
        </div>
      </div>

      {/* Expandable file tree */}
      {expanded ? (
        <div className="border-t border-border/50 bg-ink/40 px-3 py-2 space-y-2">
          {Array.from(directories.entries()).map(([dir, dirFiles]) => (
            <div key={dir} className="space-y-1">
              {dir !== "." ? (
                <div className="flex items-center gap-1.5 text-faint font-mono text-2xs">
                  <Folder className="h-3 w-3 shrink-0 text-accent/80" />
                  <span className="truncate">{dir}</span>
                </div>
              ) : null}
              <div className={cn("space-y-1", dir !== "." && "pl-4")}>
                {dirFiles.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center justify-between gap-2 py-0.5 font-mono text-2xs text-muted hover:text-text"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <FileCode className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate" title={file.path}>
                        {file.name}
                      </span>
                    </div>
                    <div className="shrink-0 space-x-1 tabular-nums">
                      {file.additions > 0 ? (
                        <span className="text-emerald-400">+{formatDiffNumber(file.additions)}</span>
                      ) : null}
                      {file.deletions > 0 ? (
                        <span className="text-rose-400">-{formatDiffNumber(file.deletions)}</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
