import { describe, expect, it } from "vitest"
import {
  SAYA_MOODS,
  SAYA_SHAPE_INFO,
  SAYA_SHAPES,
  SAYA_TONES,
  sayaCircle,
  sayaGeometry,
  sayaPick,
  sayaRoundedRect,
} from "./mascot"

/** Signed area of a closed polyline through every absolute vertex: >0 is clockwise on screen. */
function windingSign(d: string): number {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
  const points: [number, number][] = []
  for (let i = 0; i + 1 < nums.length; i += 2)
    points.push([nums[i] as number, nums[i + 1] as number])
  let sum = 0
  points.forEach(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length] as [number, number]
    sum += x1 * y2 - x2 * y1
  })
  return Math.sign(sum)
}

describe("saya mascot geometry", () => {
  it("draws every shape in every mood inside the grid", () => {
    for (const shape of SAYA_SHAPES) {
      for (const mood of SAYA_MOODS) {
        const g = sayaGeometry(shape, mood)
        expect(g.shell.startsWith("M")).toBe(true)
        expect(g.eyesFill ?? g.eyesLine).toBeTruthy()
        expect(g.visor.x).toBeGreaterThan(0)
        expect(g.visor.x + g.visor.w).toBeLessThan(100)
        expect(g.shell).not.toMatch(/NaN|undefined/)
      }
    }
  })

  it("only adds the extra for its mood", () => {
    expect(sayaGeometry("ghost", "thinking").dots).toBeTruthy()
    expect(sayaGeometry("ghost", "waiting").badge).toBeTruthy()
    expect(sayaGeometry("ghost", "waiting").bang).toBeTruthy()
    expect(sayaGeometry("ghost", "sleeping").zz).toBeTruthy()
    const idle = sayaGeometry("ghost", "idle")
    expect([idle.dots, idle.badge, idle.bang, idle.zz]).toEqual([null, null, null, null])
    expect(sayaGeometry("done" as never, "done").eyesLine).toBeTruthy()
  })

  it("builds unions from clockwise subpaths so nonzero fill never punches holes", () => {
    // Rounded rects run top edge left-to-right first (clockwise); circles sweep with flag 1.
    expect(sayaRoundedRect(10, 10, 40, 30, 8)).toMatch(/^M18 10H42A8 8 0 0 1 50 18/)
    expect(sayaCircle(50, 50, 20)).toBe("M30 50A20 20 0 1 1 70 50A20 20 0 1 1 30 50Z")
    // Bubble tail and Hoot's right tuft were reversed on purpose; keep them clockwise.
    expect(windingSign("M48 70L25.4 85.6L23 84L28 64Z")).toBe(1)
    expect(windingSign("M72 42L55 28L73 16.5L76.5 19Z")).toBe(1)
    expect(windingSign("M28 42L23.5 19L27 16.5L45 28Z")).toBe(1)
  })

  it("keeps a stable look per seed and a palette for every default tone", () => {
    expect(sayaPick("Hermes")).toEqual(sayaPick("Hermes"))
    for (const shape of SAYA_SHAPES)
      expect(SAYA_TONES[SAYA_SHAPE_INFO[shape].tone].base).toMatch(/^#[0-9a-f]{6}$/)
  })
})
