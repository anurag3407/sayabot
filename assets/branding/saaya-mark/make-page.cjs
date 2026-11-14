const fs = require("fs"), path = require("path")
const u = (n) => "data:image/svg+xml;base64," + fs.readFileSync(path.join(__dirname, "svg", n + ".svg")).toString("base64")
const I = { r: u("sayabot-icon-rounded"), mac: u("sayabot-icon-macos"), s: u("sayabot-icon-small"), mono: u("sayabot-mono-white"), b: u("alt-cursor-buddy"), c: u("alt-prompt-pal") }
const ph = (c) => `<i style="background:${c}"></i>`
const html = `<title>Sayabot Icon</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;800&family=Geist+Mono:wght@400;500&display=swap">
<style>
/* Layout: hero icon + pitch, then the icon in its real homes (dock, home screen), sizes, alternates, files. */
:root{--bg:#fbf8f8;--surface:#fff;--fg:#1b1220;--muted:#6f6471;--line:#ece4e4;--red:#ff5d6c;
--sans:"Geist",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--mono:"Geist Mono",ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#130e15;--surface:#1d1620;--fg:#f7efef;--muted:#a99ba9;--line:#2d2431;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#130e15;--surface:#1d1620;--fg:#f7efef;--muted:#a99ba9;--line:#2d2431;color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font-family:var(--sans);font-size:16px;line-height:1.55;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:40px 80px}
.wrap{max-width:1000px;margin:0 auto;display:grid;gap:64px}
h1,h2,h3,p{margin:0}h1,h2{text-wrap:balance;letter-spacing:-.02em}h2{font-size:26px;font-weight:600}
.eb{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.muted{color:var(--muted);max-width:62ch}
section{display:grid;gap:20px}
.hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:48px;align-items:center}
.hero img{width:100%;max-width:400px;filter:drop-shadow(0 30px 40px rgba(238,65,87,.35))}
.hero h1{font-size:clamp(40px,6.5vw,64px);font-weight:800;line-height:1.02}
.hero p{font-size:19px;margin-top:16px;max-width:34ch}
.why{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.why div{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:20px;display:grid;gap:6px;align-content:start}
.why h3{font-size:16px;font-weight:600}.why p{color:var(--muted);font-size:15px}
.desk{border-radius:20px;padding:120px 20px 22px;background:linear-gradient(135deg,#f5b7a8,#c77b9a 45%,#5b4a8b);display:grid;justify-items:center;overflow:hidden}
.dock{display:flex;gap:10px;padding:10px 12px;border-radius:24px;background:rgba(255,255,255,.28);border:1px solid rgba(255,255,255,.4);backdrop-filter:blur(20px);max-width:100%;overflow-x:auto}
.dock i,.dock img{flex:0 0 auto;width:64px;height:64px;display:block}
.dock i{border-radius:22.4%;transform:scale(.805)}
.dock .on{position:relative}.dock .on::after{content:"";position:absolute;left:50%;bottom:-6px;width:4px;height:4px;border-radius:50%;background:#fff;transform:translateX(-50%)}
.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.phone{border-radius:20px;padding:28px 22px;background:linear-gradient(170deg,#2c2140,#140e1a 70%);display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px 10px;justify-items:center}
.phone div{display:grid;gap:6px;justify-items:center;font-size:12px;color:#fff}
.phone i,.phone img{width:60px;height:60px;border-radius:22.4%;display:block}
.notif-wrap{border-radius:20px;padding:22px;background:var(--surface);border:1px solid var(--line);display:grid;gap:14px;align-content:center}
.notif{background:#f2edf0;color:#1b1220;border-radius:18px;padding:12px 14px;display:grid;grid-template-columns:38px minmax(0,1fr);gap:12px;align-items:center}
.notif img{width:38px;height:38px}.notif b{font-size:14px;font-weight:600}.notif p{font-size:13px;color:#4f4451}
.tab{display:flex;align-items:center;gap:8px;background:#ece6e9;color:#1b1220;border-radius:10px 10px 0 0;padding:9px 14px;font-size:13px;width:max-content;max-width:100%}
.tab img{width:16px;height:16px}
.sizes{display:flex;flex-wrap:wrap;align-items:flex-end;gap:28px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:28px}
.sizes figure{margin:0;display:grid;gap:8px;justify-items:center}.sizes figcaption{font-family:var(--mono);font-size:12px;color:var(--muted)}
.alts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.alt{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:20px;display:grid;grid-template-columns:96px minmax(0,1fr);gap:16px;align-items:center}
.alt img{width:96px;height:96px}.alt h3{font-size:16px;font-weight:600}.alt p{color:var(--muted);font-size:14px}
.files{font-family:var(--mono);font-size:13px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:20px;overflow-x:auto;white-space:pre;line-height:1.8}
@media (max-width:760px){.hero,.why,.pair,.alts{grid-template-columns:minmax(0,1fr)}.hero img{max-width:280px}}
</style>
<main class="wrap">
<header class="hero">
  <img src="${I.r}" alt="Sayabot app icon: a cute white chat bubble with two eyes, rosy cheeks and a golden AI sparkle, on coral red">
  <div><p class="eb">Sayabot · app icon</p><h1>A chat that woke up.</h1>
  <p>A speech bubble with a face and a golden AI sparkle for a cowlick. It's an agent you talk to, and it reads that way at a glance.</p></div>
</header>
<section class="why">
  <div><h3>Says "AI agent" instantly</h3><p>The chat bubble means conversation and rooms, the sparkle is the sign everyone now knows means AI, and the eyes make it someone, not a tool.</p></div>
  <div><h3>Cute, not a robot</h3><p>No antenna, visor or bolts. Soft shapes, rosy cheeks and shiny eyes make it a companion you're happy to hand work to.</p></div>
  <div><h3>Built for the dock</h3><p>A big white shape on a red gradient, sitting on Apple's macOS grid, so it stands out among blue and green icons and looks right next to them.</p></div>
</section>
<section>
  <p class="eb">macOS dock</p>
  <div class="desk"><div class="dock">${ph("#3b82f6")}${ph("#22c55e")}${ph("linear-gradient(#a78bfa,#7c3aed)")}<img class="on" src="${I.mac}" alt="Sayabot in the dock">${ph("#f59e0b")}${ph("linear-gradient(#94a3b8,#475569)")}${ph("#0ea5e9")}</div></div>
</section>
<section class="pair">
  <div class="phone">
    <div><i style="background:#22c55e"></i>Messages</div><div><i style="background:#f59e0b"></i>Notes</div><div><img src="${I.r}" alt="">Sayabot</div><div><i style="background:#3b82f6"></i>Mail</div>
    <div><i style="background:#ef4444"></i>Music</div><div><i style="background:#64748b"></i>Settings</div><div><i style="background:#0ea5e9"></i>Weather</div><div><i style="background:#a855f7"></i>Podcasts</div>
  </div>
  <div class="notif-wrap">
    <p class="eb">Notification · browser tab</p>
    <div class="notif"><img src="${I.r}" alt=""><div><b>Atlas needs your approval</b><p>Wants to open a PR on saaya/web · tap to review</p></div></div>
    <div class="tab"><img src="${I.s}" alt="">Design review · Sayabot</div>
  </div>
</section>
<section>
  <p class="eb">Size tests</p>
  <p class="muted">At 32 px and below a simpler version drops the cheeks and small sparkle, and makes the eyes and main sparkle bigger.</p>
  <div class="sizes">
    <figure><img src="${I.r}" width="180" height="180" alt=""><figcaption>180</figcaption></figure>
    <figure><img src="${I.r}" width="96" height="96" alt=""><figcaption>96</figcaption></figure>
    <figure><img src="${I.r}" width="64" height="64" alt=""><figcaption>64</figcaption></figure>
    <figure><img src="${I.s}" width="32" height="32" alt=""><figcaption>32</figcaption></figure>
    <figure><img src="${I.s}" width="16" height="16" alt=""><figcaption>16</figcaption></figure>
  </div>
</section>
<section>
  <p class="eb">Alternates, same family</p>
  <div class="alts">
    <div class="alt"><img src="${I.b}" alt=""><div><h3>Cursor Buddy</h3><p>The pointer that works your computer, with a face. Leans into the agent's own sandbox computer.</p></div></div>
    <div class="alt"><img src="${I.c}" alt=""><div><h3>Prompt Pal</h3><p>Happy ^ ^ eyes and a blinking-cursor mouth. More playful and more developer-flavoured.</p></div></div>
  </div>
</section>
<section>
  <p class="eb">Files</p>
  <div class="files">assets/branding/saaya-mark/
  build.cjs                       one geometry → every icon below
  svg/sayabot-icon.svg            iOS / Android / PWA (full-bleed, OS masks)
  svg/sayabot-icon-macos.svg      desktop dock, Apple grid (.icns source)
  svg/sayabot-icon-maskable.svg   Android adaptive / PWA safe zone
  svg/sayabot-icon-small.svg      favicon, ≤32 px
  svg/sayabot-mono-white.svg      Android notification icon
  png/  1024 · 512 · 192 · 180 · 64 · 32 · 16 · macOS 1024</div>
</section>
</main>
`
fs.writeFileSync(path.join(__dirname, "presentation.html"), html)
console.log("ok")
