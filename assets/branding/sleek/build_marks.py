#!/usr/bin/env python3
"""Sayabot sleek logo concepts — exact geometric construction on a 256 grid.

A: Shadow S   — two annular hooks, 45-degree seam splits lit face / shadow
B: Turn Ring  — open ring, lamp token seated in the gap at 45 deg
C: After Hours— two equal capsule hands from one pivot, 120 deg apart
Wordmark: SAYABOT, custom geometric monoline caps, filled paths only.
"""
import math
import os
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "masters")
os.makedirs(OUT, exist_ok=True)

INK = "#171219"


def n(v):
    s = f"{v:.1f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


def pt(cx, cy, r, deg, ry=None):
    a = math.radians(deg)
    return (cx + r * math.cos(a), cy + (ry if ry is not None else r) * math.sin(a))


def arc_pt(cx, cy, rx, ry, deg):
    return pt(cx, cy, rx, deg, ry)


def annular(cx, cy, R, h, a0, a1, cap0=True, cap1=True, ry=None, rx=None):
    """Filled annular arc. Screen angles: 0=right 90=down 180=left 270=up.
    Travels from a0 to a1 in increasing-angle (clockwise) direction."""
    Rx = rx if rx is not None else R
    Ry = ry if ry is not None else R
    span = (a1 - a0) % 360
    large = 1 if span > 180 else 0
    ox0, oy0 = arc_pt(cx, cy, Rx + h, Ry + h, a0)
    ox1, oy1 = arc_pt(cx, cy, Rx + h, Ry + h, a1)
    ix1, iy1 = arc_pt(cx, cy, Rx - h, Ry - h, a1)
    ix0, iy0 = arc_pt(cx, cy, Rx - h, Ry - h, a0)
    d = f"M{n(ox0)} {n(oy0)} "
    d += f"A{n(Rx+h)} {n(Ry+h)} 0 {large} 1 {n(ox1)} {n(oy1)} "
    if cap1:
        d += f"A{n(h)} {n(h)} 0 0 1 {n(ix1)} {n(iy1)} "
    else:
        d += f"L{n(ix1)} {n(iy1)} "
    d += f"A{n(Rx-h)} {n(Ry-h)} 0 {large} 0 {n(ix0)} {n(iy0)} "
    if cap0:
        d += f"A{n(h)} {n(h)} 0 0 1 {n(ox0)} {n(oy0)} "
    else:
        d += f"L{n(ox0)} {n(oy0)} "
    return d + "Z"


def capsule(x0, y0, x1, y1, h):
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy)
    px, py = -dy / L * h, dx / L * h
    a0, a1 = (x0 + px, y0 + py), (x1 + px, y1 + py)
    b1, b0 = (x1 - px, y1 - py), (x0 - px, y0 - py)
    return (
        f"M{n(a0[0])} {n(a0[1])} L{n(a1[0])} {n(a1[1])} "
        f"A{n(h)} {n(h)} 0 0 1 {n(b1[0])} {n(b1[1])} "
        f"L{n(b0[0])} {n(b0[1])} A{n(h)} {n(h)} 0 0 1 {n(a0[0])} {n(a0[1])} Z"
    )


def circle(cx, cy, r):
    return f"M{n(cx-r)} {n(cy)} A{n(r)} {n(r)} 0 1 1 {n(cx+r)} {n(cy)} A{n(r)} {n(r)} 0 1 1 {n(cx-r)} {n(cy)} Z"


def poly(points):
    return "M" + " L".join(f"{n(x)} {n(y)}" for x, y in points) + " Z"


def svg(paths, w=256, h=256, title="Sayabot"):
    body = "\n".join(paths)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}"'
        f' role="img" aria-labelledby="t">\n  <title id="t">{title}</title>\n{body}\n</svg>\n'
    )


def line_circle_x(k, cx, cy, r):
    """Intersections of x+y=k with circle; returns list of (x,y)."""
    v = k - cx - cy
    disc = 2 * r * r - v * v
    if disc < 0:
        return []
    s = math.sqrt(disc)
    out = []
    for u in ((v + s) / 2, (v - s) / 2):
        x = cx + u
        out.append((x, k - x))
    return out


def ang(cx, cy, p):
    return math.degrees(math.atan2(p[1] - cy, p[0] - cx)) % 360


# ---------------------------------------------------------------- A: Shadow S
def shadow_s(fill_fig=INK, fill_shad=INK, seam=18.0, R=52.0, h=21.0, scale=None):
    cx = 128.0
    c1y, c2y = 128 - R, 128 + R
    k_fig = 256 - seam / math.sqrt(2)
    k_shad = 256 + seam / math.sqrt(2)

    # top hook: terminal 315deg, travels CCW (decreasing) to waist ~90deg
    outer_f = line_circle_x(k_fig, cx, c1y, R + h)
    inner_f = line_circle_x(k_fig, cx, c1y, R - h)
    Of = max(outer_f, key=lambda p: p[1])  # waist = bottom of C1
    If = max(inner_f, key=lambda p: p[1])
    aOf, aIf = ang(cx, c1y, Of), ang(cx, c1y, If)
    # outer arc 315 -> aOf going CCW: span = (315 - aOf) % 360
    span_o = (315 - aOf) % 360
    span_i = (315 - aIf) % 360
    t_out = pt(cx, c1y, R + h, 315)
    t_in = pt(cx, c1y, R - h, 315)
    fig = (
        f"M{n(t_out[0])} {n(t_out[1])} "
        f"A{n(R+h)} {n(R+h)} 0 {1 if span_o>180 else 0} 0 {n(Of[0])} {n(Of[1])} "
        f"L{n(If[0])} {n(If[1])} "
        f"A{n(R-h)} {n(R-h)} 0 {1 if span_i>180 else 0} 1 {n(t_in[0])} {n(t_in[1])} "
        f"L{n(t_out[0])} {n(t_out[1])} Z"
    )

    # bottom hook: waist ~270deg on C2, travels CW to terminal 135deg
    outer_s = line_circle_x(k_shad, cx, c2y, R + h)
    inner_s = line_circle_x(k_shad, cx, c2y, R - h)
    Os = min(outer_s, key=lambda p: p[1])  # waist = top of C2
    Is = min(inner_s, key=lambda p: p[1])
    aOs, aIs = ang(cx, c2y, Os), ang(cx, c2y, Is)
    span_o2 = (135 - aOs) % 360
    span_i2 = (135 - aIs) % 360
    u_out = pt(cx, c2y, R + h, 135)
    u_in = pt(cx, c2y, R - h, 135)
    shad = (
        f"M{n(Os[0])} {n(Os[1])} "
        f"A{n(R+h)} {n(R+h)} 0 {1 if span_o2>180 else 0} 1 {n(u_out[0])} {n(u_out[1])} "
        f"L{n(u_in[0])} {n(u_in[1])} "
        f"A{n(R-h)} {n(R-h)} 0 {1 if span_i2>180 else 0} 0 {n(Is[0])} {n(Is[1])} "
        f"L{n(Os[0])} {n(Os[1])} Z"
    )
    paths = [f'  <path fill="{fill_fig}" d="{fig}"/>', f'  <path fill="{fill_shad}" d="{shad}"/>']
    if scale:
        return svg([f'  <g transform="translate(128 128) scale({n(scale)}) translate(-128 -128)">' ] + paths + ["  </g>"], title="Sayabot — Shadow S")
    return svg(paths, title="Sayabot — Shadow S")


# --------------------------------------------------------------- B: Turn Ring
def turn_ring(fill_ring=INK, fill_dot=INK, R=88.0, h=17.0, gap=64.0, dot_r=21.0):
    mid = 315.0
    a0 = mid + gap / 2          # 347
    a1 = mid - gap / 2 + 360    # 643 (=283)
    ring = annular(128, 128, R, h, a0, a1)
    dx, dy = pt(128, 128, R, mid)
    dot = circle(dx, dy, dot_r)
    return svg([f'  <path fill="{fill_ring}" d="{ring}"/>', f'  <path fill="{fill_dot}" d="{dot}"/>'], title="Sayabot — Turn Ring")


# ------------------------------------------------------------- C: Gateway
def gateway(fill_arch=INK, fill_dot=INK, dot_r=18.0, ground=False):
    arch = (
        "M48 216 L48 120 A80 80 0 0 1 208 120 L208 216 Z "
        "M80 216 L80 120 A48 48 0 0 1 176 120 L176 216 Z"
    )
    paths = [f'  <path fill="{fill_arch}" fill-rule="evenodd" d="{arch}"/>']
    paths.append(f'  <path fill="{fill_dot}" d="{circle(128, 150, dot_r)}"/>')
    if ground:
        paths.append(f'  <path fill="{fill_arch}" d="{capsule(44, 232, 212, 232, 8)}"/>')
    return svg(paths, title="Sayabot — Gateway")


# ------------------------------------------------------------- C alt: Phase
def phase(fill_solid=INK, fill_ring=INK, r=96.0, h=12.0):
    solid = f"M128 {n(128-r)} A{n(r)} {n(r)} 0 0 0 128 {n(128+r)} Z"
    ring = annular(128, 128, r - h, h, 270, 450)
    return svg(
        [f'  <path fill="{fill_solid}" d="{solid}"/>', f'  <path fill="{fill_ring}" d="{ring}"/>'],
        title="Sayabot — Phase",
    )


# ------------------------------------------------------------- C: Eclipse
def eclipse(fill_lit=INK, fill_shad=INK, r=84.0, off=34.0):
    # light from upper-left: lit ember disc lower-left, shadow disc crossing up-right
    lx, ly = 111.0, 143.0
    sx, sy = lx + off, ly - off
    return svg(
        [
            f'  <path fill="{fill_lit}" d="{circle(lx, ly, r)}"/>',
            f'  <path fill="{fill_shad}" d="{circle(sx, sy, r)}"/>',
        ],
        title="Sayabot — Eclipse",
    )


# ------------------------------------------------------------------ Wordmark
CAP0, CAP1 = 68.0, 188.0   # top, baseline
SV, SH = 26.0, 24.0        # vertical / horizontal stroke


def wm_s(x):
    R, h = 24.0, 13.0
    cx = x + R + h
    c1y, c2y = CAP0 + R + h - 1, CAP1 - R - h + 1
    # continuous S: top hook 315->90 CCW, bottom 270->135 CW, merged via overlap
    top = annular(cx, c1y, R, h, 90, 315)   # increasing 90->315 passes 180,270 (left,top)
    bot = annular(cx, c2y, R, h, 270, 135 + 360)
    return [top, bot], 2 * (R + h)


def wm_a(x):
    w = 92.0
    apex_l, apex_r = x + 31, x + 61
    outer = [
        (apex_l, CAP0), (apex_r, CAP0),
        (x + w, CAP1), (x + w - 26, CAP1),
        (x + 59.8, 164), (x + 32.2, 164),
        (x + 26, CAP1), (x, CAP1),
    ]
    counter = [(x + 46, 110.6), (x + 55.15, 146), (x + 36.85, 146)]
    return [poly(outer) + " " + poly(counter)], w  # evenodd via fill-rule


def wm_y(x):
    w = 88.0
    pts = [
        (x, CAP0), (x + 28, CAP0), (x + 44, 93.8),
        (x + 60, CAP0), (x + w, CAP0), (x + 57, 118),
        (x + 57, CAP1), (x + 31, CAP1), (x + 31, 118),
    ]
    return [poly(pts)], w


def wm_b(x):
    stem = poly([(x, CAP0), (x + 26, CAP0), (x + 26, CAP1), (x, CAP1)])
    ub = annular(x + 24, 96, 20, 11, 262, 98, rx=28, ry=20, cap0=False, cap1=False)
    lb = annular(x + 24, 156, 21, 11, 262, 98, rx=30, ry=21, cap0=False, cap1=False)
    return [stem + " " + ub + " " + lb], 66.0


def wm_o(x, open_seat=False):
    rx, ry, h = 50.0, 61.0, 11.0
    cx, cy = x + rx, 128.0
    if open_seat:
        ring = annular(cx, cy, 39, h, 347, 283 + 360, rx=rx - h, ry=ry - h)
        return [ring], 2 * rx
    outer = f"M{n(cx-rx)} {n(cy)} A{n(rx)} {n(ry)} 0 1 1 {n(cx+rx)} {n(cy)} A{n(rx)} {n(ry)} 0 1 1 {n(cx-rx)} {n(cy)} Z"
    irx, iry = rx - h, ry - h
    inner = f"M{n(cx-irx)} {n(cy)} A{n(irx)} {n(iry)} 0 1 0 {n(cx+irx)} {n(cy)} A{n(irx)} {n(iry)} 0 1 0 {n(cx-irx)} {n(cy)} Z"
    return [outer + " " + inner], 2 * rx


def wm_t(x):
    w = 84.0
    bar = poly([(x, CAP0), (x + w, CAP0), (x + w, CAP0 + SH), (x, CAP0 + SH)])
    stem = poly([(x + 29, CAP0), (x + 55, CAP0), (x + 55, CAP1), (x + 29, CAP1)])
    return [bar + " " + stem], w


def wordmark_paths(fill=INK, open_seat=False):
    letters = [wm_s, wm_a, wm_y, wm_a, wm_b, wm_o, wm_t]
    gaps = [20, 18, 18, 20, 20, 18]  # optical spacing
    x = 0.0
    paths = []
    for i, fn in enumerate(letters):
        if fn is wm_o:
            ds, w = fn(x, open_seat)
        else:
            ds, w = fn(x)
        for d in ds:
            rule = ' fill-rule="evenodd"' if fn is wm_a or fn is wm_o else ""
            paths.append(f'  <path fill="{fill}"{rule} d="{d}"/>')
        x += w + (gaps[i] if i < len(gaps) else 0)
    return paths, x


def wordmark(fill=INK, open_seat=False):
    paths, total = wordmark_paths(fill, open_seat)
    return svg(paths, w=math.ceil(total), h=256, title="SAYABOT"), total


if __name__ == "__main__":
    ver = sys.argv[1] if len(sys.argv) > 1 else "v1"
    files = {
        f"shadow-s-black-{ver}.svg": shadow_s(scale=0.84),
        f"turn-ring-black-{ver}.svg": turn_ring(),
        f"eclipse-black-{ver}.svg": eclipse(),
    }
    wm, wtotal = wordmark()
    files[f"sayabot-wordmark-black-{ver}.svg"] = wm
    for name, content in files.items():
        with open(os.path.join(OUT, name), "w") as f:
            f.write(content)
        print(name, len(content), "bytes")
    print("wordmark width:", wtotal)