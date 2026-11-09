"use client"

import dynamic from "next/dynamic"
import { HocuspocusProvider } from "@hocuspocus/provider"
import { useEffect, useRef, useState } from "react"
import * as Y from "yjs"
import { MonacoBinding } from "y-monaco"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { AvatarStack } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { colorForUser, peersFromAwareness, remoteCursorCss, type CanvasPeer } from "@/lib/canvas-presence"
import type { CanvasView } from "@/lib/types"

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((mod) => mod.Editor), {
  ssr: false,
  loading: () => <div className="p-4 font-mono text-[12px] text-faint">loading editor…</div>,
})

type CanvasConnection = "connecting" | "connected" | "synced" | "disconnected" | "denied"

function languageFor(canvas: CanvasView): string {
  if (canvas.kind === "markdown") return "markdown"
  if (canvas.kind === "html") return "html"
  if (canvas.kind === "svg") return "xml"
  return canvas.language || "typescript"
}

export function CanvasEditor({
  canvas,
  userId,
  userName,
  onText,
  onConnection,
}: {
  canvas: CanvasView
  userId: string
  userName: string
  onText: (text: string) => void
  onConnection: (status: CanvasConnection) => void
}) {
  const [session, setSession] = useState<{ doc: Y.Doc; provider: HocuspocusProvider } | null>(null)
  const [connection, setConnection] = useState<CanvasConnection>("connecting")
  const [peers, setPeers] = useState<CanvasPeer[]>([])
  const bindingRef = useRef<MonacoBinding | null>(null)

  useEffect(() => {
    onConnection(connection)
  }, [connection, onConnection])

  useEffect(() => {
    let disposed = false
    const doc = new Y.Doc()
    const supabase = createSupabaseBrowserClient()
    const provider = new HocuspocusProvider({
      url: process.env.NEXT_PUBLIC_COLLAB_URL ?? "ws://localhost:4000/collab",
      name: canvas.id,
      document: doc,
      token: async () => {
        const { data } = await supabase.auth.getSession()
        return data.session?.access_token ?? ""
      },
      onAuthenticationFailed: () => {
        if (!disposed) setConnection("denied")
      },
      onSynced: () => {
        if (!disposed) setConnection("synced")
      },
      onStatus: ({ status }) => {
        if (disposed) return
        setConnection(status === "connected" ? "connected" : status === "connecting" ? "connecting" : "disconnected")
      },
      onClose: () => {
        if (!disposed) setConnection("disconnected")
      },
    })
    provider.setAwarenessField("user", { id: userId, name: userName, color: colorForUser(userId) })
    setSession({ doc, provider })
    return () => {
      disposed = true
      bindingRef.current?.destroy()
      bindingRef.current = null
      provider.destroy()
      doc.destroy()
    }
  }, [canvas.id, userId, userName])

  useEffect(() => {
    const awareness = session?.provider.awareness
    if (!awareness) return
    const style = document.createElement("style")
    document.head.append(style)
    const update = () => {
      const next = peersFromAwareness(awareness.getStates(), awareness.clientID)
      style.textContent = remoteCursorCss(next)
      setPeers(next)
    }
    update()
    awareness.on("change", update)
    return () => {
      awareness.off("change", update)
      style.remove()
    }
  }, [session])

  const peerPeople = [...new Map(peers.map((peer) => [peer.userId, peer])).values()].map((peer) => ({
    id: peer.userId,
    name: peer.name,
  }))

  useEffect(() => {
    if (!session) return
    const ytext = session.doc.getText("content")
    const emit = () => onText(ytext.toString())
    emit()
    ytext.observe(emit)
    return () => ytext.unobserve(emit)
  }, [session, onText])

  const isWideEditor = canvas.kind === "markdown" || canvas.kind === "html" || canvas.kind === "svg"

  return (
    <div className="relative h-full min-h-0 bg-ink" data-canvas-connection={connection}>
      {session ? (
        <MonacoEditor
          height="100%"
          language={languageFor(canvas)}
          path={`canvas-${canvas.id}`}
          theme="mesh-dark"
          beforeMount={(monaco) => {
            monaco.editor.defineTheme("mesh-dark", {
              base: "vs-dark",
              inherit: true,
              rules: [
                { token: "comment", foreground: "6b756d", fontStyle: "italic" },
                { token: "string", foreground: "b8c9a9" },
                { token: "keyword", foreground: "ff9b72" },
                { token: "number", foreground: "d9c38e" },
                { token: "type", foreground: "a8c7c0" },
                { token: "delimiter", foreground: "9aa39b" },
              ],
              colors: {
                "editor.background": "#0b0e0c",
                "editor.foreground": "#e9e5d8",
                "editorLineNumber.foreground": "#4d5750",
                "editorLineNumber.activeForeground": "#9aa39b",
                "editor.lineHighlightBackground": "#151b17",
                "editor.lineHighlightBorder": "#00000000",
                "editorCursor.foreground": "#ff7a45",
                "editor.selectionBackground": "#3a2418",
                "editor.inactiveSelectionBackground": "#241a14",
                "editorIndentGuide.background1": "#232b25",
                "editorIndentGuide.activeBackground1": "#354037",
                "editorGutter.background": "#0b0e0c",
                "editorWidget.background": "#151b17",
                "editorWidget.border": "#354037",
                "input.background": "#101411",
                "dropdown.background": "#151b17",
                "scrollbarSlider.background": "#35403766",
                "minimap.background": "#0b0e0c",
              },
            })
          }}
          onMount={(editor) => {
            const model = editor.getModel()
            if (!model) return
            bindingRef.current = new MonacoBinding(
              session.doc.getText("content"),
              model,
              new Set([editor]),
              session.provider.awareness,
            )
          }}
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            fontSize: 13,
            lineHeight: 21,
            padding: { top: 12, bottom: 12 },
            scrollBeyondLastLine: false,
            renderLineHighlight: "none",
            glyphMargin: false,
            folding: true,
            smoothScrolling: false,
            cursorBlinking: "solid",
            cursorSmoothCaretAnimation: "off",
            wordWrap: isWideEditor ? "on" : "off",
            tabSize: 2,
            renderWhitespace: "selection",
            fixedOverflowWidgets: true,
            scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          }}
        />
      ) : (
        <div className="grid h-full place-items-center font-mono text-[12px] text-faint">
          opening canvas…
        </div>
      )}

      {peerPeople.length > 0 ? (
        <div className="pointer-events-none absolute right-4 top-2 z-10 flex items-center gap-2 rounded-full border border-line bg-panel py-0.5 pl-2.5 pr-1">
          <span className="font-mono text-[11px] text-faint">also editing</span>
          <AvatarStack people={peerPeople} max={4} />
        </div>
      ) : null}

      {connection === "denied" ? (
        <div className="absolute inset-0 grid place-items-center bg-void/90 p-6">
          <div className="max-w-sm border-l-2 border-[var(--color-danger)] pl-4">
            <p className="font-mono text-[12px] text-danger">could not open this canvas</p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              You may have been signed out, or you may no longer have access to this room. Reload
              to try again.
            </p>
            <Button className="mt-3" size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      ) : null}

      {connection === "disconnected" ? (
        <div className="pointer-events-none absolute bottom-2 right-2 rounded-sm border border-line bg-panel px-2 py-1 font-mono text-[11px] text-warn">
          editing offline, changes sync when reconnected
        </div>
      ) : null}
      {connection === "connecting" || connection === "connected" ? (
        <div className="pointer-events-none absolute bottom-2 right-2 rounded-sm border border-line bg-panel px-2 py-1 font-mono text-[11px] text-faint">
          syncing canvas…
        </div>
      ) : null}
    </div>
  )
}
