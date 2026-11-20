/**
 * Comprehensive Mock Testkits for Sayabot Autonomous Agent Engine.
 * Provides zero-external-dependency fakes for Composio, Video Meetings, Android Phones, and Virtual Desktops.
 */

export class FakeComposioServer {
  public executedCalls: Array<{ tool: string; args: Record<string, unknown>; userId: string }> = []
  public connectedToolkits: Set<string> = new Set(["gmail", "slack", "github", "linear"])

  handleRequest(url: string, init: RequestInit = {}): Response {
    const parsed = new URL(url, "https://backend.composio.dev")
    const pathname = parsed.pathname

    if (pathname.endsWith("/toolkits")) {
      return new Response(
        JSON.stringify({
          items: Array.from(this.connectedToolkits).map((slug) => ({
            slug,
            name: slug.toUpperCase(),
            meta: { description: `Integration with ${slug}` },
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }

    if (pathname.endsWith("/tools")) {
      const toolkit = parsed.searchParams.get("toolkit_slug") || "gmail"
      return new Response(
        JSON.stringify({
          items: [
            { slug: `${toolkit.toUpperCase()}_FETCH_DATA`, name: `Fetch ${toolkit} Data`, description: "Read data" },
            { slug: `${toolkit.toUpperCase()}_SEND_ITEM`, name: `Send ${toolkit} Item`, description: "Mutate data" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }

    if (pathname.includes("/tools/execute/")) {
      const toolSlug = decodeURIComponent(pathname.split("/tools/execute/")[1] || "")
      const body = JSON.parse((init.body as string) || "{}")
      this.executedCalls.push({ tool: toolSlug, args: body.arguments || {}, userId: body.user_id })

      return new Response(
        JSON.stringify({
          successful: true,
          data: { status: "success", executed: toolSlug, timestamp: new Date().toISOString() },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }

    if (pathname.endsWith("/connected_accounts/link")) {
      return new Response(
        JSON.stringify({ redirect_url: "https://connect.composio.dev/auth/mock-link-123" }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 })
  }
}

export class FakePhoneDevice {
  public serial = "emulator-5554"
  public touches: Array<{ x: number; y: number }> = []
  public swipes: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  public keys: string[] = []
  public typedTexts: string[] = []
  public launchedPackages: string[] = []

  tap(x: number, y: number) {
    this.touches.push({ x, y })
  }

  swipe(x1: number, y1: number, x2: number, y2: number) {
    this.swipes.push({ x1, y1, x2, y2 })
  }

  pressKey(key: string) {
    this.keys.push(key)
  }

  typeText(text: string) {
    this.typedTexts.push(text)
  }

  launchApp(pkg: string) {
    this.launchedPackages.push(pkg)
  }
}

export class FakeVirtualDesktop {
  public mousePos = { x: 0, y: 0 }
  public clickedButtons: number[] = []
  public typedStrings: string[] = []
  public pressedKeys: string[] = []
  public activeWindow = "Visual Studio Code"

  mouseAction(action: string, x: number, y: number, button = 1) {
    this.mousePos = { x, y }
    if (action.includes("click")) {
      this.clickedButtons.push(button)
    }
  }

  keyboardAction(action: string, text?: string, key?: string) {
    if (action === "type" && text) {
      this.typedStrings.push(text)
    }
    if (action === "press" && key) {
      this.pressedKeys.push(key)
    }
  }
}
