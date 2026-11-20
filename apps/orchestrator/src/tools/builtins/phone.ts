import { z } from "zod"
import { getComputerClient } from "../../computer/client"
import type { ToolSpec } from "../audited"

export interface PhoneToolsOptions {
  orgId: string
  agentId: string
  roomId: string
}

export function phoneTools(opts: PhoneToolsOptions): ToolSpec[] {
  const { agentId } = opts

  const androidDeviceTool: ToolSpec = {
    name: "android_device_control",
    description:
      "Interact with connected physical or emulated Android devices via ADB / scrcpy bridge. Allows listing devices, capturing screen, tapping coordinates, swiping, typing text, pressing hardware keys (HOME, BACK, ENTER, APP_SWITCH), and launching apps.",
    schema: z.object({
      action: z
        .enum(["list_devices", "get_info", "screenshot", "tap", "swipe", "key", "type_text", "launch_app"])
        .describe("The mobile device operation to perform"),
      serial: z.string().optional().describe("Target device serial number when multiple phones are attached"),
      x: z.number().optional().describe("X pixel coordinate for tap or swipe start"),
      y: z.number().optional().describe("Y pixel coordinate for tap or swipe start"),
      end_x: z.number().optional().describe("End X pixel coordinate for swipe gesture"),
      end_y: z.number().optional().describe("End Y pixel coordinate for swipe gesture"),
      duration_ms: z.number().optional().default(300).describe("Swipe gesture duration in milliseconds"),
      key: z
        .string()
        .optional()
        .describe("Hardware key name: HOME, BACK, ENTER, APP_SWITCH, VOLUME_UP, VOLUME_DOWN, POWER"),
      text: z.string().optional().describe("Text string to type into the focused input field"),
      package_name: z.string().optional().describe("App package name to launch, e.g. com.android.chrome"),
    }),
    dangerous: (args: Record<string, unknown>) => {
      const act = String(args.action ?? "")
      // Read-only actions do not require approval; interactive mutations require approval
      return act !== "list_devices" && act !== "screenshot" && act !== "get_info"
    },
    execute: async (input: {
      action: string
      serial?: string
      x?: number
      y?: number
      end_x?: number
      end_y?: number
      duration_ms?: number
      key?: string
      text?: string
      package_name?: string
    }) => {
      try {
        const client = getComputerClient()

        if (input.action === "list_devices") {
          const res = await client.phone(agentId, "list")
          return { ok: true, action: "list_devices", ...(res as Record<string, unknown>) }
        }

        if (input.action === "get_info") {
          const res = await client.phone(agentId, "info", { serial: input.serial })
          return { ok: true, action: "get_info", ...(res as Record<string, unknown>) }
        }

        if (input.action === "screenshot") {
          const res = await client.phone(agentId, "screenshot", {
            serial: input.serial,
          })
          return { ok: true, action: "screenshot", ...(res as Record<string, unknown>) }
        }

        if (input.action === "tap") {
          if (input.x === undefined || input.y === undefined) {
            return { ok: false, error: "X and Y coordinates are required for tap action" }
          }
          const res = await client.phone(agentId, "tap", {
            x: input.x,
            y: input.y,
            serial: input.serial,
          })
          return { ok: true, action: "tap", x: input.x, y: input.y, ...(res as Record<string, unknown>) }
        }

        if (input.action === "swipe") {
          if (
            input.x === undefined ||
            input.y === undefined ||
            input.end_x === undefined ||
            input.end_y === undefined
          ) {
            return { ok: false, error: "Start (x, y) and end (end_x, end_y) coordinates are required for swipe" }
          }
          const res = await client.phone(agentId, "swipe", {
            x1: input.x,
            y1: input.y,
            x2: input.end_x,
            y2: input.end_y,
            durationMs: input.duration_ms,
            serial: input.serial,
          })
          return { ok: true, action: "swipe", ...(res as Record<string, unknown>) }
        }

        if (input.action === "key") {
          if (!input.key) {
            return { ok: false, error: "Key name is required for key action" }
          }
          const res = await client.phone(agentId, "key", {
            key: input.key,
            serial: input.serial,
          })
          return { ok: true, action: "key", key: input.key, ...(res as Record<string, unknown>) }
        }

        if (input.action === "type_text") {
          if (input.text === undefined) {
            return { ok: false, error: "Text is required for type_text action" }
          }
          const res = await client.phone(agentId, "text", {
            text: input.text,
            serial: input.serial,
          })
          return { ok: true, action: "type_text", text: input.text, ...(res as Record<string, unknown>) }
        }

        if (input.action === "launch_app") {
          if (!input.package_name) {
            return { ok: false, error: "package_name is required for launch_app action" }
          }
          const res = await client.phone(agentId, "launch", {
            packageName: input.package_name,
            serial: input.serial,
          })
          return { ok: true, action: "launch_app", packageName: input.package_name, ...(res as Record<string, unknown>) }
        }

        return { ok: false, error: `Unsupported phone action: ${input.action}` }
      } catch (err: any) {
        return { ok: false, error: err.message || String(err) }
      }
    },
  }

  return [androidDeviceTool]
}
