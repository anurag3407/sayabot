import { describe, expect, it, vi } from "vitest"
import { DockerClient } from "../../src/docker"

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  })
  return calls
}

describe("DockerClient (fetch stubbed)", () => {
  it("trims the trailing slash from the base URL", async () => {
    const calls = stubFetch(() => Response.json({ State: { Running: true } }))
    const client = new DockerClient("http://docker:2375/")
    await client.inspectContainer("bot-a1")
    expect(calls[0]!.url).toBe("http://docker:2375/containers/bot-a1/json")
  })

  it("inspectContainer returns null on 404, rethrows other errors", async () => {
    stubFetch(() => new Response("nope", { status: 404 }))
    await expect(new DockerClient("http://d").inspectContainer("x")).resolves.toBeNull()
    stubFetch(() => new Response("boom", { status: 500 }))
    await expect(new DockerClient("http://d").inspectContainer("x")).rejects.toThrow(/500/)
  })

  it("create/start/stop/remove hit the right endpoints", async () => {
    const calls = stubFetch(() => Response.json({ Id: "abc" }))
    const client = new DockerClient("http://d")
    await expect(client.createContainer({ Image: "img", name: "n" })).resolves.toEqual({ Id: "abc" })
    expect(calls[0]!.url).toContain("/containers/create?name=n")
    await client.startContainer("n")
    expect(calls.at(-1)!.url).toContain("/containers/n/start")
    await client.stopContainer("n", 5)
    expect(calls.at(-1)!.url).toContain("/containers/n/stop?t=5")
    await client.removeContainer("n")
    expect(calls.at(-1)!.url).toContain("/containers/n?force=true&v=true")
    await client.removeVolume("v1")
    expect(calls.at(-1)!.url).toContain("/volumes/v1?force=true")
  })

  it("execCreate posts Cmd and execStart posts Detach/Tty", async () => {
    const calls = stubFetch((url) => url.includes("/start") ? new Response("out") : Response.json({ Id: "e1" }))
    const client = new DockerClient("http://d")
    await expect(client.execCreate("c1", ["ls"])).resolves.toEqual({ Id: "e1" })
    expect(JSON.parse(String(calls[0]!.init!.body))).toMatchObject({ Cmd: ["ls"], AttachStdout: true })
    const res = await client.execStart("e1")
    expect(await res.text()).toBe("out")
  })

  it("ping is true on 2xx and false on network failure", async () => {
    stubFetch(() => new Response("OK"))
    await expect(new DockerClient("http://d").ping()).resolves.toBe(true)
    vi.stubGlobal("fetch", async () => { throw new Error("down") })
    await expect(new DockerClient("http://d").ping()).resolves.toBe(false)
  })
})
