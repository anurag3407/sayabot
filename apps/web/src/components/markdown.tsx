"use client"

import React, { useMemo } from "react"
import { Streamdown, type Components, type CustomRenderer } from "streamdown"
import { code } from "@streamdown/code"
import { createMathPlugin } from "@streamdown/math"
import { createMermaidPlugin } from "@streamdown/mermaid"
import { isPdfUrl, PdfViewer } from "@/components/chat/pdf-viewer"
import { MermaidErrorFallback } from "@/components/chat/mermaid-error"
import { Callout, parseAlert } from "@/components/chat/callout"
import { ImageWithLightbox } from "@/components/chat/image-lightbox"
import { useTheme } from "@/components/theme-provider"
import { ExternalLink } from "lucide-react"

// Create dark-mode configured Mermaid plugin
const mermaidPluginDark = createMermaidPlugin({
  config: {
    startOnLoad: false,
    theme: "dark",
    securityLevel: "loose",
    fontFamily: "var(--font-mono), monospace",
    suppressErrorRendering: true,
    themeVariables: {
      darkMode: true,
      background: "#141415",
      mainBkg: "#1a1a1c",
      primaryColor: "#232325",
      primaryTextColor: "#f4f3f1",
      primaryBorderColor: "#3b3b40",
      lineColor: "#b6a9ff",
      secondaryColor: "#1e1e21",
      tertiaryColor: "#2c2c2f",
      textColor: "#f4f3f1",
      fontSize: "13px",
      fontFamily: "var(--font-mono), monospace",
      nodeBorder: "#3b3b40",
      clusterBkg: "#141415",
      clusterBorder: "#27272a",
      edgeLabelBackground: "#1a1a1c",
      actorBkg: "#232325",
      actorBorder: "#3b3b40",
      actorTextColor: "#f4f3f1",
      actorLineColor: "#85858d",
      signalColor: "#f4f3f1",
      signalTextColor: "#f4f3f1",
      labelBoxBkgColor: "#232325",
      labelBoxBorderColor: "#3b3b40",
      labelTextColor: "#f4f3f1",
      loopTextColor: "#f4f3f1",
      noteBorderColor: "#3b3b40",
      noteBkgColor: "#1e1e21",
      noteTextColor: "#f4f3f1",
      activationBorderColor: "#9d8cff",
      activationBkgColor: "#1d1a33",
      sequenceNumberColor: "#0b0b0c",
      git0: "#9d8cff",
      git1: "#5b9df5",
      git2: "#4fcdb0",
      git3: "#f2c14e",
    },
  },
})

// Create light-mode configured Mermaid plugin
const mermaidPluginLight = createMermaidPlugin({
  config: {
    startOnLoad: false,
    theme: "default",
    securityLevel: "loose",
    fontFamily: "var(--font-mono), monospace",
    suppressErrorRendering: true,
    themeVariables: {
      darkMode: false,
      background: "#ffffff",
      mainBkg: "#f8f9fa",
      primaryColor: "#ededf1",
      primaryTextColor: "#18181b",
      primaryBorderColor: "#d2d2db",
      lineColor: "#6d5ce8",
      secondaryColor: "#f5f5f7",
      tertiaryColor: "#e4e4ea",
      textColor: "#18181b",
      fontSize: "13px",
      fontFamily: "var(--font-mono), monospace",
      nodeBorder: "#d2d2db",
      clusterBkg: "#f5f5f7",
      clusterBorder: "#d2d2db",
      edgeLabelBackground: "#ffffff",
      actorBkg: "#ffffff",
      actorBorder: "#d2d2db",
      actorTextColor: "#18181b",
      actorLineColor: "#7a7a85",
      signalColor: "#18181b",
      signalTextColor: "#18181b",
      labelBoxBkgColor: "#ffffff",
      labelBoxBorderColor: "#d2d2db",
      labelTextColor: "#18181b",
      loopTextColor: "#18181b",
      noteBorderColor: "#d2d2db",
      noteBkgColor: "#f5f5f7",
      noteTextColor: "#18181b",
      activationBorderColor: "#6d5ce8",
      activationBkgColor: "rgba(109, 92, 232, 0.12)",
      sequenceNumberColor: "#ffffff",
      git0: "#6d5ce8",
      git1: "#0550ae",
      git2: "#2e9a59",
      git3: "#a06a12",
    },
  },
})

// Create KaTeX math plugin with single dollar math enabled
const mathPlugin = createMathPlugin({ singleDollarTextMath: true })

// Dedicated renderer for ```pdf code fences
const pdfRenderer: CustomRenderer = {
  language: ["pdf", "pdf-viewer"],
  component: ({ code }) => <PdfViewer url={code.trim()} />,
}

function isMediaUrl(url: string | null | undefined): { isVideo: boolean; isAudio: boolean } {
  if (!url) return { isVideo: false, isAudio: false }
  const clean = (url.split("?")[0] ?? "").split("#")[0]?.toLowerCase() ?? ""
  const isVideo = clean.endsWith(".mp4") || clean.endsWith(".webm") || clean.endsWith(".mov")
  const isAudio =
    clean.endsWith(".mp3") ||
    clean.endsWith(".wav") ||
    clean.endsWith(".ogg") ||
    clean.endsWith(".m4a")
  return { isVideo, isAudio }
}

export function Markdown({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const { resolvedTheme } = useTheme()
  const plugins = useMemo(
    () => ({
      code,
      math: mathPlugin,
      mermaid: resolvedTheme === "light" ? mermaidPluginLight : mermaidPluginDark,
      renderers: [pdfRenderer],
    }),
    [resolvedTheme],
  )
  const components: Components = useMemo(
    () => ({
      a: ({ href, children, ...props }) => {
        // If it's a PDF link or PDF data URI, render the interactive PDF Viewer!
        if (href && isPdfUrl(href)) {
          const title = typeof children === "string" ? children : undefined
          return <PdfViewer url={href} title={title} />
        }

        // If it's a media URL, render responsive audio/video players
        const media = isMediaUrl(href)
        if (media.isVideo && href) {
          return (
            <video
              src={href}
              controls
              className="my-3 max-h-96 w-full max-w-2xl rounded-xl border border-line bg-void"
            />
          )
        }
        if (media.isAudio && href) {
          return <audio src={href} controls className="my-2 w-full max-w-md rounded-lg" />
        }

        // External links handling
        const isExternal = href?.startsWith("http://") || href?.startsWith("https://")
        return (
          <a
            href={href}
            target={isExternal ? "_blank" : undefined}
            rel={isExternal ? "noopener noreferrer" : undefined}
            className="font-medium text-accent hover:underline break-words [overflow-wrap:anywhere]"
            {...props}
          >
            {children}
            {isExternal ? (
              <ExternalLink className="inline ml-1 h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
            ) : null}
          </a>
        )
      },

      img: ({ src, alt, ...props }) => {
        const srcStr = typeof src === "string" ? src : undefined
        if (srcStr && isPdfUrl(srcStr)) {
          return <PdfViewer url={srcStr} title={alt} />
        }
        return <ImageWithLightbox src={srcStr} alt={alt} {...props} />
      },

      blockquote: ({ children, ...props }) => {
        const alert = parseAlert(children)
        if (alert.isAlert && alert.type) {
          return (
            <Callout type={alert.type} title={alert.title}>
              {alert.content}
            </Callout>
          )
        }
        return (
          <blockquote className="my-2.5 border-l-2 border-line-strong pl-3.5 text-muted italic" {...props}>
            {children}
          </blockquote>
        )
      },

      code: ({ className, children, ...props }: any) => {
        // Handle inline code badges vs block code
        const isInline = !className && typeof children === "string" && !children.includes("\n")
        if (isInline) {
          const text = String(children)
          // Sleek tag pill for "# file.ext"
          if (text.startsWith("# ")) {
            const fileName = text.slice(2)
            return (
              <span className="inline-flex items-center gap-1 rounded border border-border/70 bg-panel px-1.5 py-0.5 font-mono text-2xs font-medium text-text">
                <span className="text-accent">#</span>
                <span>{fileName}</span>
              </span>
            )
          }
          return (
            <code
              className="rounded border border-border/60 bg-panel/80 px-1.5 py-0.5 font-mono text-2xs text-text [overflow-wrap:anywhere]"
              {...props}
            >
              {children}
            </code>
          )
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      },

      table: ({ children, ...props }) => (
        <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-border/70 bg-panel/40">
          <table className="w-full border-collapse text-xs" {...props}>
            {children}
          </table>
        </div>
      ),

      th: ({ children, ...props }: any) => (
        <th
          className="border-b border-border/70 bg-ink/60 px-3 py-2 text-left font-medium text-text"
          {...props}
        >
          {children}
        </th>
      ),

      td: ({ children, ...props }: any) => (
        <td className="border-b border-border/40 px-3 py-2 text-muted" {...props}>
          {children}
        </td>
      ),

      ul: ({ children, ...props }: any) => (
        <ul className="my-2 ml-4 list-disc space-y-1 text-sm text-text/95 leading-relaxed" {...props}>
          {children}
        </ul>
      ),

      ol: ({ children, ...props }: any) => (
        <ol className="my-2 ml-4 list-decimal space-y-1 text-sm text-text/95 leading-relaxed" {...props}>
          {children}
        </ol>
      ),

      li: ({ children, ...props }: any) => (
        <li className="leading-relaxed" {...props}>
          {children}
        </li>
      ),

      h1: ({ children, ...props }: any) => (
        <h1 className="mt-4 mb-2 text-lg font-semibold text-text tracking-tight" {...props}>
          {children}
        </h1>
      ),

      h2: ({ children, ...props }: any) => (
        <h2 className="mt-3.5 mb-1.5 text-base font-semibold text-text tracking-tight" {...props}>
          {children}
        </h2>
      ),

      h3: ({ children, ...props }: any) => (
        <h3 className="mt-3 mb-1 text-sm font-semibold text-text tracking-tight" {...props}>
          {children}
        </h3>
      ),

      p: ({ children, ...props }: any) => (
        <p className="my-2 text-[14px] leading-relaxed text-text/95" {...props}>
          {children}
        </p>
      ),
    }),
    [],
  )

  if (!content) return null

  return (
    <Streamdown
      className="streamdown chat-markdown"
      plugins={plugins}
      mermaid={{
        errorComponent: (props) => <MermaidErrorFallback {...props} isStreaming={streaming} />,
      }}
      mode={streaming ? "streaming" : "static"}
      parseIncompleteMarkdown
      components={components}
    >
      {content}
    </Streamdown>
  )
}
