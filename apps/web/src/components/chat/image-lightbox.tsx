"use client"

import { useEffect, useState } from "react"
import { Download, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react"
import { cn } from "@/lib/format"

interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string
  alt?: string
}

export function ImageWithLightbox({ src, alt, className, ...props }: ImageProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false)
        setZoom(100)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isOpen])

  if (!src) return null

  if (hasError) {
    return (
      <span className="my-2 inline-flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 font-mono text-[12px] text-muted">
        <span>Image failed to load:</span>
        <span className="truncate max-w-[200px] text-faint">{alt || src}</span>
      </span>
    )
  }

  return (
    <>
      <span className="group relative my-3 inline-block cursor-zoom-in overflow-hidden rounded-xl border border-line bg-panel transition-all hover:border-line-strong">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt || "Image preview"}
          className={cn("max-h-[440px] max-w-full rounded-xl object-contain transition-transform duration-200 group-hover:scale-[1.01]", className)}
          onError={() => setHasError(true)}
          onClick={() => setIsOpen(true)}
          loading="lazy"
          {...props}
        />
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-void/70 text-text opacity-0 backdrop-blur-xs transition-opacity hover:bg-void group-hover:opacity-100"
          title="Zoom image"
          aria-label="Zoom image"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </span>

      {/* Fullscreen Lightbox Modal */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt || "Image lightbox"}
          className="fixed inset-0 z-[120] flex flex-col bg-void/95 p-4 backdrop-blur-md"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsOpen(false)
              setZoom(100)
            }
          }}
        >
          {/* Top Bar */}
          <div className="flex items-center justify-between border-b border-line pb-3">
            <span className="max-w-[50vw] truncate text-[13px] font-medium text-text">
              {alt || "Image preview"}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setZoom((prev) => Math.max(prev - 25, 50))}
                className="grid h-8 w-8 place-items-center rounded-md bg-raised text-muted hover:bg-hover hover:text-text disabled:opacity-30"
                title="Zoom out"
                disabled={zoom <= 50}
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(100)}
                className="px-2 font-mono text-[11px] text-muted hover:text-text"
                title="Reset zoom"
              >
                {zoom}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((prev) => Math.min(prev + 25, 300))}
                className="grid h-8 w-8 place-items-center rounded-md bg-raised text-muted hover:bg-hover hover:text-text disabled:opacity-30"
                title="Zoom in"
                disabled={zoom >= 300}
              >
                <ZoomIn className="h-4 w-4" />
              </button>

              <a
                href={src}
                download={alt || "image"}
                className="grid h-8 w-8 place-items-center rounded-md bg-raised text-muted hover:bg-hover hover:text-text"
                title="Download image"
              >
                <Download className="h-4 w-4" />
              </a>

              <button
                type="button"
                onClick={() => {
                  setIsOpen(false)
                  setZoom(100)
                }}
                className="grid h-8 w-8 place-items-center rounded-md bg-hover text-muted hover:bg-raised hover:text-text"
                title="Close (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Image Centered View */}
          <div className="flex flex-1 items-center justify-center overflow-auto p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt || "Enlarged preview"}
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: "center center" }}
              className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain transition-transform duration-150"
            />
          </div>
        </div>
      )}
    </>
  )
}
