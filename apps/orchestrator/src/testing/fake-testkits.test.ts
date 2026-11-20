import { describe, expect, it } from "vitest"
import { ComposioConnector } from "../connectors/composio"
import {
  FakeComposioServer,
  FakePhoneDevice,
  FakeVirtualDesktop,
} from "./fake-testkits"

describe("Fake Testkits Harness", () => {
  it("simulates Composio API responses deterministically", async () => {
    const fakeServer = new FakeComposioServer()
    const connector = new ComposioConnector({
      apiKey: "test-key-123",
      baseUrl: "https://backend.composio.dev/api/v3",
      fetchFn: async (url, init) => fakeServer.handleRequest(url as string, init),
    })

    const toolkits = await connector.toolkits()
    expect(toolkits.length).toBeGreaterThan(0)
    expect(toolkits.some((t) => t.slug === "gmail")).toBe(true)

    const tools = await connector.tools({ toolkit: "gmail" })
    expect(tools.length).toBe(2)
    expect(tools[0]?.slug).toBe("GMAIL_FETCH_DATA")

    const res = (await connector.execute({
      toolSlug: "GMAIL_FETCH_DATA",
      userId: "user-1",
      arguments: { maxResults: 10 },
    })) as any

    expect(res.status).toBe("success")
    expect(fakeServer.executedCalls).toHaveLength(1)
    expect(fakeServer.executedCalls[0]?.tool).toBe("GMAIL_FETCH_DATA")
    expect(fakeServer.executedCalls[0]?.args).toEqual({ maxResults: 10 })
  })

  it("simulates phone device interactions", () => {
    const phone = new FakePhoneDevice()
    phone.tap(100, 200)
    phone.swipe(100, 200, 100, 800)
    phone.pressKey("HOME")
    phone.typeText("search query")
    phone.launchApp("com.android.chrome")

    expect(phone.touches).toEqual([{ x: 100, y: 200 }])
    expect(phone.swipes).toEqual([{ x1: 100, y1: 200, x2: 100, y2: 800 }])
    expect(phone.keys).toContain("HOME")
    expect(phone.typedTexts).toContain("search query")
    expect(phone.launchedPackages).toContain("com.android.chrome")
  })

  it("simulates virtual desktop mouse and keyboard interactions", () => {
    const desktop = new FakeVirtualDesktop()
    desktop.mouseAction("click", 500, 400, 1)
    desktop.keyboardAction("type", "npm run build")
    desktop.keyboardAction("press", undefined, "Return")

    expect(desktop.mousePos).toEqual({ x: 500, y: 400 })
    expect(desktop.clickedButtons).toContain(1)
    expect(desktop.typedStrings).toContain("npm run build")
    expect(desktop.pressedKeys).toContain("Return")
  })
})
