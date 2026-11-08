"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Maximize2,
  Minimize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { cn } from "@/lib/format"

/**
 * Checks whether a URL, path, or data URI points to a PDF.
 */
export function isPdfUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false
  const trimmed = url.trim().toLowerCase()
  if (trimmed.startsWith("data:application/pdf")) return true
  if (trimmed.startsWith("blob:") && trimmed.includes("pdf")) return true
  try {
    const parsed = new URL(trimmed, "http://localhost")
    return (
      parsed.pathname.endsWith(".pdf") ||
      parsed.searchParams.get("format") === "pdf" ||
      parsed.searchParams.get("type") === "pdf"
    )
  } catch {
    return /\.pdf([?#]|$)/i.test(trimmed)
  }
}

/**
 * Extracts a readable filename from a PDF URL or path.
 */
export function extractPdfFilename(url: string, fallbackTitle?: string): string {
  if (fallbackTitle && fallbackTitle.trim() && !fallbackTitle.startsWith("http")) {
    return fallbackTitle.trim()
  }
  if (url.startsWith("data:application/pdf")) {
    return "Document.pdf"
  }
  try {
    const parsed = new URL(url, "http://localhost")
    const segments = parsed.pathname.split("/").filter(Boolean)
    const last = segments[segments.length - 1]
    if (last && last.toLowerCase().endsWith(".pdf")) {
      return decodeURIComponent(last)
    }
  } catch {
    // ignore
  }
  return "Document.pdf"
}

/**
 * Extracts the domain/source of the PDF for context.
 */
function extractSource(url: string): string {
  if (url.startsWith("data:application/pdf")) return "Data Attachment"
  if (url.startsWith("blob:")) return "Local Blob"
  try {
    const parsed = new URL(url, "http://localhost")
    return parsed.hostname
  } catch {
    return "External"
  }
}

interface PdfViewerProps {
  url: string
  title?: string
  className?: string
  defaultCollapsed?: boolean
}

export function PdfViewer({
  url,
  title,
  className,
  defaultCollapsed = false,
}: PdfViewerProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState<number>(100)
  const [viewMode, setViewMode] = useState<"FitH" | "Fit" | "auto">("FitH")
  const [loadError, setLoadError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const componentId = useId()

  const filename = useMemo(() => extractPdfFilename(url, title), [url, title])
  const source = useMemo(() => extractSource(url), [url])

  // Build the PDF hash parameters for the embedded viewer
  const iframeSrc = useMemo(() => {
    // If it's a data URL or blob, we append hash parameters carefully
    const base = url
    const params: string[] = ["toolbar=1", "navpanes=0"]
    if (page > 1) params.push(`page=${page}`)
    if (viewMode !== "auto") params.push(`view=${viewMode}`)
    if (zoom !== 100) params.push(`zoom=${zoom}`)
    const hash = `#${params.join("&")}`
    return `${base}${hash}`
  }, [url, page, viewMode, zoom])

  // Escape key handler for fullscreen modal
  useEffect(() => {
    if (!isFullscreen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isFullscreen])

  function handleZoomIn() {
    setViewMode("auto")
    setZoom((prev) => Math.min(prev + 25, 250))
  }

  function handleZoomOut() {
    setViewMode("auto")
    setZoom((prev) => Math.max(prev - 25, 50))
  }

  function handleResetZoom() {
    setViewMode("FitH")
    setZoom(100)
  }

  function handlePrevPage() {
    setPage((prev) => Math.max(prev - 1, 1))
  }

  function handleNextPage() {
    setPage((prev) => prev + 1)
  }

  return (
    <div
      className={cn(
        "my-3 w-full rounded-xl border border-line bg-panel text-text shadow-sm transition-all",
        className,
      )}
      data-testid="pdf-viewer-card"
    >
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        {/* Left: Icon & Title */}
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-400 ring-1 ring-red-500/25"
            aria-hidden="true"
          >
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="truncate text-[13px] font-medium text-text"
                title={filename}
              >
                {filename}
              </span>
              <span className="shrink-0 rounded bg-line px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
                PDF
              </span>
            </div>
            <p className="truncate font-mono text-[11px] text-faint">{source}</p>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          {/* Page controls (only when expanded) */}
          {!collapsed && (
            <div className="mr-1 hidden items-center gap-1 rounded-md border border-line bg-raised px-1 sm:flex">
              <button
                type="button"
                onClick={handlePrevPage}
                disabled={page <= 1}
                className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-hover hover:text-text disabled:opacity-30"
                title="Previous page"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[28px] text-center font-mono text-[11px] text-text">
                {page}
              </span>
              <button
                type="button"
                onClick={handleNextPage}
                className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-hover hover:text-text"
                title="Next page"
                aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Zoom controls (only when expanded) */}
          {!collapsed && (
            <div className="hidden items-center gap-0.5 rounded-md border border-line bg-raised p-0.5 md:flex">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoom <= 50}
                className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-hover hover:text-text disabled:opacity-30"
                title="Zoom out"
                aria-label="Zoom out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleResetZoom}
                className="px-1.5 font-mono text-[11px] text-muted hover:text-text"
                title="Fit width (100%)"
              >
                {zoom}%
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoom >= 250}
                className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-hover hover:text-text disabled:opacity-30"
                title="Zoom in"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Fullscreen button */}
          {!collapsed && (
            <button
              type="button"
              onClick={() => setIsFullscreen(true)}
              className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-raised hover:text-text"
              title="View full screen"
              aria-label="View full screen"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Download button */}
          <a
            href={url}
            download={filename}
            className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-raised hover:text-text"
            title="Download PDF"
            aria-label="Download PDF"
          >
            <Download className="h-3.5 w-3.5" />
          </a>

          {/* Open in new tab button */}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-raised hover:text-text"
            title="Open in new window"
            aria-label="Open in new window"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>

          {/* Collapse/Expand Toggle */}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="ml-1 inline-flex h-7 items-center gap-1 rounded-md bg-raised px-2 font-mono text-[11px] text-muted hover:bg-hover hover:text-text"
            aria-expanded={!collapsed}
          >
            {collapsed ? "Preview" : "Collapse"}
          </button>
        </div>
      </div>

      {/* Viewer Body */}
      {!collapsed && (
        <div className="relative h-[480px] w-full overflow-hidden rounded-b-xl bg-[#232325]">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-panel/90 backdrop-blur-xs">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
              <span className="font-mono text-[12px] text-muted">Loading PDF preview…</span>
            </div>
          )}

          {loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-raised text-warn">
                <FileText className="h-5 w-5" />
              </div>
              <div className="max-w-md">
                <p className="text-[14px] font-medium text-text">Preview unavailable inline</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  The host server does not allow embedding this document in an iframe, or your
                  browser blocked the preview. You can open or download it directly.
                </p>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-text px-3 text-[12px] font-medium text-void transition-colors hover:bg-accent"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open PDF
                </a>
                <a
                  href={url}
                  download={filename}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-raised px-3 text-[12px] font-medium text-text hover:bg-hover"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              </div>
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              key={iframeSrc}
              id={`pdf-frame-${componentId}`}
              src={iframeSrc}
              title={`${filename} PDF viewer`}
              className="h-full w-full border-0"
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setIsLoading(false)
                setLoadError(true)
              }}
            />
          )}
        </div>
      )}

      {/* Fullscreen Lightbox Modal */}
      {isFullscreen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${filename} full screen viewer`}
          className="fixed inset-0 z-[120] flex flex-col bg-void/95 p-3 backdrop-blur-md sm:p-6"
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/15 text-red-400">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-text">{filename}</h3>
                <p className="font-mono text-[11px] text-faint">{source}</p>
              </div>
            </div>

            {/* Modal Controls */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-md border border-line bg-raised px-1.5 py-0.5">
                <button
                  type="button"
                  onClick={handlePrevPage}
                  disabled={page <= 1}
                  className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-hover hover:text-text disabled:opacity-30"
                  title="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[32px] text-center font-mono text-[12px] text-text">
                  {page}
                </span>
                <button
                  type="button"
                  onClick={handleNextPage}
                  className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-hover hover:text-text"
                  title="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="hidden items-center gap-1 rounded-md border border-line bg-raised p-0.5 sm:flex">
                <button
                  type="button"
                  onClick={handleZoomOut}
                  disabled={zoom <= 50}
                  className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-hover hover:text-text disabled:opacity-30"
                  title="Zoom out"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleResetZoom}
                  className="px-2 font-mono text-[12px] text-muted hover:text-text"
                  title="Reset zoom"
                >
                  {zoom}%
                </button>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  disabled={zoom >= 250}
                  className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-hover hover:text-text disabled:opacity-30"
                  title="Zoom in"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
              </div>

              <a
                href={url}
                download={filename}
                className="grid h-8 w-8 place-items-center rounded-lg bg-raised text-muted hover:bg-hover hover:text-text"
                title="Download PDF"
              >
                <Download className="h-4 w-4" />
              </a>

              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="grid h-8 w-8 place-items-center rounded-lg bg-raised text-muted hover:bg-hover hover:text-text"
                title="Open in new window"
              >
                <ExternalLink className="h-4 w-4" />
              </a>

              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="grid h-8 w-8 place-items-center rounded-lg bg-hover text-muted hover:bg-raised hover:text-text"
                title="Close fullscreen (Esc)"
                aria-label="Close fullscreen"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Modal Fullscreen Body */}
          <div className="relative mt-3 flex-1 overflow-hidden rounded-xl border border-line bg-[#232325]">
            <iframe
              src={iframeSrc}
              title={`${filename} full view`}
              className="h-full w-full border-0"
            />
          </div>
        </div>
      )}
    </div>
  )
}
