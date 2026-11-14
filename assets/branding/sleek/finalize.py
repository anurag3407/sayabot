#!/usr/bin/env python3
"""Final masters + horizontal lockups (light & dark) for the chosen trio."""
import math, os, re
from build_marks import (shadow_s, turn_ring, gateway, wordmark_paths, svg, OUT)

E, D, L, V, P = "#ff5d6c", "#c63e4f", "#ffd08a", "#171219", "#f7efe3"
FINAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "final")
os.makedirs(FINAL, exist_ok=True)


def strip(s):
    return s.split("</title>\n", 1)[1].rsplit("</svg>", 1)[0].rstrip()


def lockup(symbol_svg, wm_fill, visual_right, name):
    inner = strip(symbol_svg)
    wm_paths, wm_total = wordmark_paths(wm_fill)
    s = 1.15
    x0 = visual_right + 48
    ty = 128 - 128 * s
    width = math.ceil(x0 + wm_total * s)
    body = (
        f'  <g id="symbol">\n{inner}\n  </g>\n'
        f'  <g id="wordmark" transform="translate({x0:.1f} {ty:.1f}) scale({s})">\n'
        + "\n".join(wm_paths) + "\n  </g>"
    )
    out = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 256" width="{width}" height="256"'
        f' role="img" aria-labelledby="t">\n  <title id="t">Sayabot</title>\n{body}\n</svg>\n'
    )
    open(os.path.join(FINAL, name), "w").write(out)
    return width


A = shadow_s(E, D, scale=0.84)
B_dark = turn_ring(E, L)
B_light = turn_ring(E, D)
C_light = gateway(V, E)
C_dark = gateway(P, E)

symbols = {
    "sayabot-shadow-s.svg": A,
    "sayabot-turn-ring.svg": B_dark,
    "sayabot-turn-ring-light.svg": B_light,
    "sayabot-gateway.svg": C_light,
    "sayabot-gateway-dark.svg": C_dark,
}
for k, v in symbols.items():
    open(os.path.join(FINAL, k), "w").write(v)

wm, wm_w = wordmark_paths(E)
open(os.path.join(FINAL, "sayabot-wordmark.svg"), "w").write(
    svg(wm, w=math.ceil(wm_w), h=256, title="SAYABOT")
)

lockups = [
    (A, V, 189.3, "sayabot-shadow-s-lockup.svg"),
    (A, P, 189.3, "sayabot-shadow-s-lockup-dark.svg"),
    (B_light, V, 233, "sayabot-turn-ring-lockup.svg"),
    (B_dark, P, 233, "sayabot-turn-ring-lockup-dark.svg"),
    (C_light, V, 208, "sayabot-gateway-lockup.svg"),
    (C_dark, P, 208, "sayabot-gateway-lockup-dark.svg"),
]
for sym, wf, vr, name in lockups:
    w = lockup(sym, wf, vr, name)
    print(name, w)
print("symbols + wordmark written")