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
import { ExternalLink } from "lucide-react"

// Create dark-mode configured Mermaid plugin
const mermaidPlugin = createMermaidPlugin({
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
      lineColor: "#ff7a86",
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
      activationBorderColor: "#ff5d6c",
      activationBkgColor: "#2e1619",
      sequenceNumberColor: "#0b0b0c",
      git0: "#ff5d6c",
      git1: "#5b9df5",
      git2: "#4fcdb0",
      git3: "#f2c14e",
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

const plugins = {
  code,
  math: mathPlugin,
  mermaid: mermaidPlugin,
  renderers: [pdfRenderer],
}

function isMediaUrl(url: string | null | undefined): { isVideo: boolean; isAudio: boolean } {
  if (!url) return { isVideo: false, isAudio: false }
  const clean = (url.split("?")[0] ?? "").split("#")[0]?.toLowerCase() ?? ""
  const isVideo = clean.endsWith(".mp4") || clean.endsWith(".webm") || clean.endsWith(".mov")
  const isAudio =
    clean.endsWith(".mp3") || clean.endsWith(".wav") || clean.endsWith(".ogg") || clean.endsWith(".m4a")
  return { isVideo, isAudio }
}

export function Markdown({
  content,
  streaming = false,
}: {
  content: string
  streaming?: boolean
}) {
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
          return (
            <audio src={href} controls className="my-2 w-full max-w-md rounded-lg" />
          )
        }

        // External links handling
        const isExternal = href?.startsWith("http://") || href?.startsWith("https://")
        return (
          <a
            href={href}
            target={isExternal ? "_blank" : undefined}
            rel={isExternal ? "noopener noreferrer" : undefined}
            className="inline-flex items-center gap-0.5 hover:underline"
            {...props}
          >
            {children}
            {isExternal ? (
              <ExternalLink className="inline h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
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
        return <blockquote {...props}>{children}</blockquote>
      },

      table: ({ children, ...props }) => (
        <div className="my-3 max-w-full overflow-x-auto rounded-xl border border-line">
          <table className="w-full border-collapse" {...props}>
            {children}
          </table>
        </div>
      ),
    }),
    [],
  )

  if (!content) return null

  return (
    <Streamdown
      className="streamdown"
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
