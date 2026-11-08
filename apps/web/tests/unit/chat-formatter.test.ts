import { describe, expect, it } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { extractPdfFilename, isPdfUrl, PdfViewer } from "../../src/components/chat/pdf-viewer"
import { Callout, parseAlert } from "../../src/components/chat/callout"

describe("PDF URL and Filename Detection", () => {
  it("detects valid PDF URLs and paths", () => {
    expect(isPdfUrl("https://example.com/reports/financials.pdf")).toBe(true)
    expect(isPdfUrl("http://localhost:3000/docs/spec.pdf#page=2")).toBe(true)
    expect(isPdfUrl("https://api.domain.org/download?format=pdf")).toBe(true)
    expect(isPdfUrl("/files/user-manual.PDF")).toBe(true)
    expect(isPdfUrl("data:application/pdf;base64,JVBERi0xLjQK")).toBe(true)
  })

  it("rejects non-PDF URLs", () => {
    expect(isPdfUrl("https://example.com/image.png")).toBe(false)
    expect(isPdfUrl("https://example.com/file.pdf.jpg")).toBe(false)
    expect(isPdfUrl("https://example.com/pdf-info")).toBe(false)
    expect(isPdfUrl("")).toBe(false)
    expect(isPdfUrl(null)).toBe(false)
    expect(isPdfUrl(undefined)).toBe(false)
  })

  it("extracts clean filenames from URLs", () => {
    expect(extractPdfFilename("https://example.com/annual_report_2025.pdf")).toBe(
      "annual_report_2025.pdf",
    )
    expect(extractPdfFilename("https://example.com/files/Meeting%20Notes.pdf")).toBe(
      "Meeting Notes.pdf",
    )
    expect(extractPdfFilename("data:application/pdf;base64,...")).toBe("Document.pdf")
    expect(extractPdfFilename("https://example.com/report.pdf", "Custom Specification")).toBe(
      "Custom Specification",
    )
  })
})

describe("GitHub Markdown Alerts Parser", () => {
  it("parses [!NOTE] alert", () => {
    const result = parseAlert("[!NOTE]\nThis is a key note.")
    expect(result.isAlert).toBe(true)
    expect(result.type).toBe("NOTE")
    expect(result.title).toBe("Note")
  })

  it("parses [!WARNING] alert", () => {
    const result = parseAlert("[!WARNING] Be careful with this action.")
    expect(result.isAlert).toBe(true)
    expect(result.type).toBe("WARNING")
    expect(result.title).toBe("Warning")
  })

  it("parses [!TIP], [!IMPORTANT], and [!CAUTION]", () => {
    expect(parseAlert("[!TIP] Optimization trick").type).toBe("TIP")
    expect(parseAlert("[!IMPORTANT] Required field").type).toBe("IMPORTANT")
    expect(parseAlert("[!CAUTION] Data loss risk").type).toBe("CAUTION")
  })

  it("ignores non-alert blockquotes", () => {
    expect(parseAlert("Just a regular quote.").isAlert).toBe(false)
    expect(parseAlert("Note: This is not an alert tag.").isAlert).toBe(false)
    expect(parseAlert("").isAlert).toBe(false)
    expect(parseAlert(null).isAlert).toBe(false)
  })
})

describe("Formatter Components SSR Rendering", () => {
  it("renders Callout with note style and icon", () => {
    const element = React.createElement(
      Callout,
      { type: "NOTE" },
      React.createElement("p", null, "System update in progress"),
    )
    const html = renderToStaticMarkup(element)
    expect(html).toContain("Note")
    expect(html).toContain("System update in progress")
    expect(html).toContain('role="note"')
  })

  it("renders Callout with caution style", () => {
    const element = React.createElement(
      Callout,
      { type: "CAUTION" },
      React.createElement("p", null, "Dangerous operation"),
    )
    const html = renderToStaticMarkup(element)
    expect(html).toContain("Caution")
    expect(html).toContain("Dangerous operation")
  })

  it("renders PdfViewer card with filename, download, and open links", () => {
    const element = React.createElement(PdfViewer, {
      url: "https://example.com/q4_results.pdf",
      title: "Q4 Financial Report",
    })
    const html = renderToStaticMarkup(element)
    expect(html).toContain("Q4 Financial Report")
    expect(html).toContain("PDF")
    expect(html).toContain("example.com")
    expect(html).toContain("Download PDF")
    expect(html).toContain("Open in new window")
    expect(html).toContain("q4_results.pdf")
  })
})
