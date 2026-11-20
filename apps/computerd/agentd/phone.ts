import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface AndroidDevice {
  serial: string
  state: "device" | "offline" | "unauthorized" | "bootloader"
  model?: string
  product?: string
}

export interface DeviceScreenSize {
  width: number
  height: number
  density?: number
}

/**
 * Standard Android KeyEvent codes.
 */
export const ANDROID_KEYCODES: Record<string, number> = {
  HOME: 3,
  BACK: 4,
  CALL: 5,
  ENDCALL: 6,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  POWER: 26,
  CAMERA: 27,
  CLEAR: 28,
  ENTER: 66,
  DEL: 67, // Backspace
  TAB: 61,
  SPACE: 62,
  APP_SWITCH: 187, // Recent apps
}

export class AndroidDeviceManager {
  private adbPath: string

  constructor(adbPath = process.env.ADB_PATH || "adb") {
    this.adbPath = adbPath
  }

  private async execAdb(args: string[], timeoutMs = 15_000): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFileAsync(this.adbPath, args, { timeout: timeoutMs })
    } catch (err: any) {
      throw new Error(`ADB command failed [${args.join(" ")}]: ${err.message || String(err)}`)
    }
  }

  async listDevices(): Promise<AndroidDevice[]> {
    try {
      const { stdout } = await this.execAdb(["devices", "-l"])
      const lines = stdout.split(/\r?\n/).slice(1) // Skip "List of devices attached"
      const devices: AndroidDevice[] = []

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const parts = trimmed.split(/\s+/)
        const serial = parts[0]
        const state = parts[1] as AndroidDevice["state"]
        if (!serial || !state) continue

        let model: string | undefined
        let product: string | undefined

        for (const token of parts.slice(2)) {
          if (token.startsWith("model:")) model = token.replace("model:", "")
          if (token.startsWith("product:")) product = token.replace("product:", "")
        }

        devices.push({ serial, state, model, product })
      }
      return devices
    } catch {
      return []
    }
  }

  async getScreenSize(serial?: string): Promise<DeviceScreenSize> {
    const args = serial ? ["-s", serial, "shell", "wm", "size"] : ["shell", "wm", "size"]
    const { stdout } = await this.execAdb(args)
    // Physical size: 1080x2400
    const match = stdout.match(/Physical size:\s*(\d+)x(\d+)/i) || stdout.match(/(\d+)x(\d+)/)
    if (!match || !match[1] || !match[2]) {
      return { width: 1080, height: 1920 }
    }
    return {
      width: parseInt(match[1], 10),
      height: parseInt(match[2], 10),
    }
  }

  async captureScreenshotBase64(serial?: string): Promise<string> {
    const args = serial ? ["-s", serial, "exec-out", "screencap", "-p"] : ["exec-out", "screencap", "-p"]
    try {
      const { stdout } = await execFileAsync(this.adbPath, args, {
        encoding: "buffer" as any,
        timeout: 10_000,
        maxBuffer: 10 * 1024 * 1024,
      })
      const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
      return `data:image/png;base64,${buf.toString("base64")}`
    } catch (e: any) {
      throw new Error(`Failed to capture Android screenshot: ${e.message}`)
    }
  }

  async tap(x: number, y: number, serial?: string): Promise<void> {
    const args = serial
      ? ["-s", serial, "shell", "input", "tap", String(x), String(y)]
      : ["shell", "input", "tap", String(x), String(y)]
    await this.execAdb(args)
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, durationMs = 300, serial?: string): Promise<void> {
    const args = serial
      ? ["-s", serial, "shell", "input", "swipe", String(x1), String(y1), String(x2), String(y2), String(durationMs)]
      : ["shell", "input", "swipe", String(x1), String(y1), String(x2), String(y2), String(durationMs)]
    await this.execAdb(args)
  }

  async pressKey(key: string, serial?: string): Promise<void> {
    const keyUpper = key.toUpperCase()
    const code = ANDROID_KEYCODES[keyUpper] ?? (!isNaN(Number(key)) ? Number(key) : 3)
    const args = serial
      ? ["-s", serial, "shell", "input", "keyevent", String(code)]
      : ["shell", "input", "keyevent", String(code)]
    await this.execAdb(args)
  }

  async typeText(text: string, serial?: string): Promise<void> {
    // Escape characters that shell interprets
    const escaped = text.replace(/([ "$\\])/g, "\\$1")
    const args = serial
      ? ["-s", serial, "shell", "input", "text", escaped]
      : ["shell", "input", "text", escaped]
    await this.execAdb(args)
  }

  async launchApp(packageName: string, serial?: string): Promise<void> {
    const args = serial
      ? ["-s", serial, "shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"]
      : ["shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"]
    await this.execAdb(args)
  }
}

export const androidDeviceManager = new AndroidDeviceManager()
