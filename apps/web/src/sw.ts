/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker"
import {
  NetworkOnly,
  Serwist,
  type PrecacheEntry,
  type RuntimeCaching,
  type SerwistGlobalConfig,
} from "serwist"

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

// Authenticated HTML and RSC payloads must never sit in a shared browser cache.
const noPageCache: RuntimeCaching = {
  matcher: ({ request, url: { pathname }, sameOrigin }) =>
    sameOrigin &&
    !pathname.startsWith("/api/") &&
    (request.mode === "navigate" || request.headers.get("RSC") === "1"),
  handler: new NetworkOnly(),
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [noPageCache, ...defaultCache],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document"
        },
      },
    ],
  },
})

serwist.addEventListeners()

interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
  kind?: "approval" | "request" | "done"
  toolCallId?: string
}

interface NotificationData {
  url: string
  toolCallId?: string
}

self.addEventListener("push", (event) => {
  let payload: PushPayload = {}
  try {
    payload = event.data?.json() ?? {}
  } catch {
    payload = { body: event.data?.text() }
  }
  // Approvals carry buttons that decide right from the notification, and stay up until acted on.
  const approval = payload.kind === "approval" && Boolean(payload.toolCallId)
  const options: NotificationOptions & { actions?: { action: string; title: string }[] } = {
    body: payload.body ?? "An agent needs your attention.",
    tag: payload.tag,
    icon: "/icon.svg",
    data: { url: payload.url ?? "/", toolCallId: payload.toolCallId } satisfies NotificationData,
    requireInteraction: approval,
    ...(approval
      ? {
          actions: [
            { action: "allow", title: "Allow" },
            { action: "deny", title: "Don't allow" },
          ],
        }
      : {}),
  }
  event.waitUntil(self.registration.showNotification(payload.title ?? "Sayabot", options))
})

async function openOrFocus(target: string) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  for (const client of windows) {
    if (new URL(client.url).origin === self.location.origin) {
      await client.navigate(target)
      return client.focus()
    }
  }
  return self.clients.openWindow(target)
}

/** Allow / Don't allow from the notification. Uses the signed-in session cookie (same origin). */
async function decide(toolCallId: string, approved: boolean): Promise<boolean> {
  try {
    const res = await fetch(`/api/v1/tools/${encodeURIComponent(toolCallId)}/approve`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved }),
    })
    return res.ok
  } catch {
    return false
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const data = (event.notification.data as NotificationData | null) ?? { url: "/" }
  const target = new URL(data.url ?? "/", self.location.origin).href
  const action = event.action
  event.waitUntil(
    (async () => {
      if ((action === "allow" || action === "deny") && data.toolCallId) {
        const approved = action === "allow"
        if (await decide(data.toolCallId, approved)) {
          return self.registration.showNotification(approved ? "Allowed" : "Not allowed", {
            body: approved ? "The agent is carrying on." : "The agent was told no.",
            icon: "/icon.svg",
            tag: `decided-${data.toolCallId}`,
          })
        }
        // Expired, already decided, or signed out: open the Inbox so the person can see why.
      }
      return openOrFocus(target)
    })(),
  )
})
