import { describe, expect, it } from "vitest"
import { materializeCopy, parseWorkspaceCopy } from "./workspace-copy"

const id = "11111111-1111-4111-8111-111111111111"
const other = "22222222-2222-4222-8222-222222222222"

describe("parseWorkspaceCopy", () => {
  it("keeps bots, chats, routines, and sealed keys, and drops a plaintext-looking key", () => {
    const copy = parseWorkspaceCopy({
      bots: [{ id, handle: "Ada", displayName: "Ada" }],
      chats: [{ id: other, name: "Room", messages: [{ id, senderType: "human", content: "hi" }] }],
      routines: [{ id, name: "Morning", agentId: id, scheduleExpr: "0 9 * * *", prompt: "Check" }],
      keys: [
        { id, provider: "anthropic", label: "Claude", ciphertext: "abc", iv: "iv", tag: "tag", last4: "wxyz" },
        { id: other, provider: "anthropic", label: "Open", apiKey: "sk-live" },
      ],
    })
    expect(copy.bots[0]?.handle).toBe("ada")
    expect(copy.chats[0]?.messages).toHaveLength(1)
    expect(copy.routines).toHaveLength(1)
    expect(copy.keys).toHaveLength(1)
    expect(JSON.stringify(copy.keys)).not.toContain("sk-live")
    const withComputer = parseWorkspaceCopy({
      bots: [],
      chats: [],
      routines: [],
      keys: [],
      computers: {
        boatCiphertext: "sealed",
        boatIv: "iv",
        boatTag: "tag",
        boatLast4: "wxyz",
        vpsSshAlias: "lab.example",
        vpsStartAutomatically: true,
        boatToken: "boat_should_not_stick",
      },
    })
    expect(withComputer.computers).toBeNull()
    const sealed = parseWorkspaceCopy({
      bots: [],
      chats: [],
      routines: [],
      keys: [],
      computers: { boatCiphertext: "sealed", boatIv: "iv", boatTag: "tag", boatLast4: "wxyz", vpsSshAlias: "lab.example" },
    })
    expect(sealed.computers?.boatLast4).toBe("wxyz")
    expect(JSON.stringify(sealed.computers)).not.toContain("boat_")
  })
})

describe("materializeCopy", () => {
  it("leaves a bot Cloud already has, and still adds the Mac-only chat", () => {
    const incoming = parseWorkspaceCopy({
      bots: [
        { id, handle: "ada", displayName: "Mac Ada" },
        { id: other, handle: "ada", displayName: "Same handle" },
      ],
      chats: [{ id, name: "Mac room" }],
      routines: [],
      keys: [],
    })
    const plan = materializeCopy({ botIds: [], handles: ["ada"], chatIds: [], routineIds: [], keyIds: [] }, incoming)
    expect(plan.bots).toEqual([])
    expect(plan.chats.map((chat) => chat.name)).toEqual(["Mac room"])
    const withComputer = parseWorkspaceCopy({
      bots: [],
      chats: [],
      routines: [],
      keys: [],
      computers: { boatCiphertext: "sealed", boatIv: "iv", boatTag: "tag", boatLast4: "wxyz" },
    })
    expect(materializeCopy({ botIds: [], handles: [], chatIds: [], routineIds: [], keyIds: [], computerSettings: true }, withComputer).computers).toBeNull()
    expect(materializeCopy({ botIds: [], handles: [], chatIds: [], routineIds: [], keyIds: [] }, withComputer).computers?.boatLast4).toBe("wxyz")
  })
})
