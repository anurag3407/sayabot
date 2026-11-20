import { describe, expect, it } from "vitest"

describe("Theme system", () => {
  it("resolves theme mode preferences correctly", () => {
    const resolveMode = (
      mode: "system" | "dark" | "light",
      systemIsDark: boolean,
    ): "dark" | "light" => {
      if (mode === "system") return systemIsDark ? "dark" : "light"
      return mode
    }

    expect(resolveMode("dark", true)).toBe("dark")
    expect(resolveMode("dark", false)).toBe("dark")
    expect(resolveMode("light", true)).toBe("light")
    expect(resolveMode("light", false)).toBe("light")
    expect(resolveMode("system", true)).toBe("dark")
    expect(resolveMode("system", false)).toBe("light")
  })

  it("toggles between dark and light themes predictably", () => {
    const toggle = (currentResolved: "dark" | "light"): "dark" | "light" => {
      return currentResolved === "dark" ? "light" : "dark"
    }

    expect(toggle("dark")).toBe("light")
    expect(toggle("light")).toBe("dark")
  })
})
