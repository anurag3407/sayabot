#!/usr/bin/env python3
"""Color masters + alternates for visual comparison."""
import math, os
from build_marks import shadow_s, turn_ring, eclipse, wordmark, circle, svg, n, OUT

EMBER, DEEP, LAMP, VOID, PAPER = "#ff5d6c", "#c63e4f", "#ffd08a", "#171219", "#f7efe3"

def crescent(r=84.0, off=34.0, fill=VOID):
    lx, ly = 111.0, 143.0
    sx, sy = lx + off, ly - off
    d = math.hypot(sx - lx, sy - ly)
    mx, my = (lx + sx) / 2, (ly + sy) / 2
    hc = math.sqrt(r * r - (d / 2) ** 2)
    ux, uy = (sx - lx) / d, (sy - ly) / d
    px, py = -uy, ux
    p1 = (mx + hc * px, my + hc * py)
    p2 = (mx - hc * px, my - hc * py)
    # lit disc arc (long way, lower-left) then shadow disc arc (short way) back
    d_str = (
        f"M{n(p1[0])} {n(p1[1])} "
        f"A{n(r)} {n(r)} 0 1 1 {n(p2[0])} {n(p2[1])} "
        f"A{n(r)} {n(r)} 0 0 0 {n(p1[0])} {n(p1[1])} Z"
    )
    return svg([f'  <path fill="{fill}" d="{d_str}"/>'], title="Sayabot — Eclipse crescent (mono cut)")

files = {
    "shadow-s-color-v2.svg": shadow_s(EMBER, DEEP, scale=0.84),
    "shadow-s-color-alt-v2.svg": shadow_s(EMBER, VOID, scale=0.84),
    "turn-ring-color-v2.svg": turn_ring(EMBER, LAMP),
    "turn-ring-color-alt-v2.svg": turn_ring(VOID, LAMP),
    "eclipse-color-v2.svg": eclipse(EMBER, DEEP),
    "eclipse-color-alt-v2.svg": eclipse(EMBER, VOID),
    "eclipse-crescent-black-v2.svg": crescent(fill=VOID),
}
wm, _ = wordmark(EMBER)
files["sayabot-wordmark-color-v2.svg"] = wm
for name, content in files.items():
    open(os.path.join(OUT, name), "w").write(content)
    print(name)