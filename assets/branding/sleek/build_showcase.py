#!/usr/bin/env python3
"""Inject the SVG masters into the showcase template -> showcase.html (self-contained)."""
import json, os, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
F = os.path.join(HERE, "final")
V = os.path.join(F, "variants")


def rd(p):
    with open(p, encoding="utf-8") as f:
        return f.read().strip()


def mark(k):
    return {
        "colorDark": rd(os.path.join(F, {"shadow-s": "sayabot-shadow-s.svg", "turn-ring": "sayabot-turn-ring.svg", "gateway": "sayabot-gateway-dark.svg"}[k])),
        "colorLight": rd(os.path.join(F, {"shadow-s": "sayabot-shadow-s.svg", "turn-ring": "sayabot-turn-ring-light.svg", "gateway": "sayabot-gateway.svg"}[k])),
        "mono": rd(os.path.join(V, f"sayabot-{k}-mono-ff5d6c.svg")),
        "black": rd(os.path.join(V, f"sayabot-{k}-black.svg")),
        "white": rd(os.path.join(V, f"sayabot-{k}-white.svg")),
        "lockupLight": rd(os.path.join(F, f"sayabot-{k}-lockup.svg")),
        "lockupDark": rd(os.path.join(F, f"sayabot-{k}-lockup-dark.svg")),
        "lockupMono": rd(os.path.join(V, f"sayabot-{k}-lockup-mono-ff5d6c.svg")),
        "lockupBlack": rd(os.path.join(V, f"sayabot-{k}-lockup-black.svg")),
        "lockupWhite": rd(os.path.join(V, f"sayabot-{k}-lockup-white.svg")),
        "appIcon": rd(os.path.join(V, f"sayabot-{k}-app-icon.svg")),
        "favicon": rd(os.path.join(V, f"sayabot-{k}-favicon.svg")),
    }


data = {"wordmark": rd(os.path.join(F, "sayabot-wordmark.svg")),
        "marks": {k: mark(k) for k in ("shadow-s", "turn-ring", "gateway")}}

tpl = rd(os.path.join(HERE, "showcase.template.html"))
assert "__DATA__" in tpl
fav = rd(os.path.join(V, "sayabot-shadow-s-favicon.svg"))
fav_uri = "data:image/svg+xml," + urllib.parse.quote(fav, safe="")
out = tpl.replace("__FAVICON__", fav_uri).replace("__DATA__", json.dumps(data))
with open(os.path.join(HERE, "showcase.html"), "w", encoding="utf-8") as f:
    f.write(out)
print("showcase.html", len(out), "bytes")