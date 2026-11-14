const { chromium } = require("@playwright/test")
const fs = require("fs")
const path = require("path")
const OUT = path.join(__dirname, "renders")
const DL = path.join(OUT, "qa-downloads")
fs.mkdirSync(DL, { recursive: true })
const URL = "http://localhost:8765/showcase.html"

const overflow = () => {
  const vw = document.documentElement.clientWidth
  const bad = []
  document.querySelectorAll("body *").forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
      const cls = (el.className.baseVal !== undefined ? el.className.baseVal : el.className) || ""
      bad.push({ tag: el.tagName, cls: String(cls).slice(0, 30), id: el.id, right: Math.round(r.right) })
    }
  })
  return { vw, scrollW: document.documentElement.scrollWidth, count: bad.length, bad: bad.slice(0, 12) }
}
const settle = async (page) => {
  await page.evaluate(async () => {
    const h = document.body.scrollHeight
    for (let y = 0; y < h; y += 500) { window.scrollTo({ top: y, behavior: "instant" }); await new Promise((r) => setTimeout(r, 40)) }
    await new Promise((r) => setTimeout(r, 350))
    window.scrollTo({ top: 0, behavior: "instant" })
  })
  await page.waitForTimeout(900)
}

;(async () => {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" })
  const report = { console: [], pageerrors: [], desktop: {}, mobile: {}, interactions: [] }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:8765" })
  const page = await ctx.newPage()
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") report.console.push(m.type() + ": " + m.text()) })
  page.on("pageerror", (e) => report.pageerrors.push(String(e)))
  await page.goto(URL, { waitUntil: "networkidle" })
  await settle(page)

  report.desktop.overflow = await page.evaluate(overflow)
  report.desktop.height = await page.evaluate(() => document.body.scrollHeight)
  report.desktop.reveal = await page.evaluate(() => ({ total: document.querySelectorAll(".reveal").length, inn: document.querySelectorAll(".reveal.in").length }))
  report.desktop.topState = await page.evaluate(() => ({ toastTop: Math.round(document.getElementById("toast").getBoundingClientRect().top), innerH: window.innerHeight, active: (document.querySelector(".nav nav a.active") || null) && document.querySelector(".nav nav a.active").getAttribute("href") }))
  await page.screenshot({ path: path.join(OUT, "qa-desktop.png"), fullPage: true })

  // interactions on shadow-s
  const card = page.locator('.concept[data-key="shadow-s"]')
  const before = await card.locator(".preview").innerHTML()
  await card.locator('.seg[data-role="view"] button[data-val="lockup"]').click()
  await card.locator('.seg[data-role="bg"] button[data-val="paper"]').click()
  await card.locator('.seg[data-role="variant"] button[data-val="ember"]').click()
  const afterLockup = await card.locator(".preview").innerHTML()
  report.interactions.push({ step: "lockup+paper+ember", changed: afterLockup !== before, hasWordmark: afterLockup.includes('id="wordmark"'), pressed: await card.locator('.seg[data-role="view"] button[data-val="lockup"]').getAttribute("aria-pressed") })
  await card.locator('.seg[data-role="view"] button[data-val="symbol"]').click()
  await card.locator('input[data-role="grid"]').check()
  report.interactions.push({ step: "grid on", gridOn: await card.locator(".grid-ov").evaluate((e) => e.classList.contains("on")) })
  await card.locator('input[data-role="size"]').fill("384")
  report.interactions.push({ step: "size 384", output: (await card.locator(".range output").textContent()).trim(), pngLabel: (await card.locator(".png-size").textContent()).trim(), previewW: await card.locator(".preview").evaluate((e) => e.style.width) })
  // downloads
  const [dlSvg] = await Promise.all([page.waitForEvent("download"), card.locator('button[data-act="svg"]').click()])
  const svgPath = path.join(DL, dlSvg.suggestedFilename())
  await dlSvg.saveAs(svgPath)
  report.interactions.push({ step: "download svg", file: dlSvg.suggestedFilename(), bytes: fs.statSync(svgPath).size })
  await card.locator('button[data-act="copy"]').click()
  await page.waitForTimeout(300)
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  report.interactions.push({ step: "copy svg", clipStartsSvg: clip.trim().startsWith("<svg"), clipLen: clip.length, toast: (await page.locator("#toast").textContent()).trim() })
  const [dlPng] = await Promise.all([page.waitForEvent("download"), card.locator('button[data-act="png"]').click()])
  const pngPath = path.join(DL, dlPng.suggestedFilename())
  await dlPng.saveAs(pngPath)
  report.interactions.push({ step: "download png", file: dlPng.suggestedFilename(), bytes: fs.statSync(pngPath).size })
  // palette copy
  await page.locator(".swatch").first().click()
  await page.waitForTimeout(200)
  report.interactions.push({ step: "swatch copy", clip: await page.evaluate(() => navigator.clipboard.readText()) })
  // theme
  await page.locator("#themeToggle").click()
  await page.waitForTimeout(400)
  report.interactions.push({ step: "theme", theme: await page.evaluate(() => document.documentElement.dataset.theme), label: (await page.locator("#themeLabel").textContent()).trim() })
  await page.screenshot({ path: path.join(OUT, "qa-desktop-light.png"), fullPage: false })
  await page.locator("#themeToggle").click()
  // nav scroll-spy + anchor landing
  await page.locator('.nav nav a[href="#system"]').click()
  await page.waitForTimeout(900)
  report.interactions.push({
    step: "nav anchor + spy",
    active: await page.evaluate(() => (document.querySelector(".nav nav a.active") || {}).getAttribute ? document.querySelector(".nav nav a.active").getAttribute("href") : null),
    sectionTop: await page.evaluate(() => Math.round(document.getElementById("system").getBoundingClientRect().top)),
    navBottom: await page.evaluate(() => Math.round(document.querySelector(".nav").getBoundingClientRect().bottom)),
  })
  await ctx.close()

  // mobile
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, isMobile: true, hasTouch: true })
  const mp = await mctx.newPage()
  mp.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") report.console.push("mobile " + m.type() + ": " + m.text()) })
  mp.on("pageerror", (e) => report.pageerrors.push("mobile " + String(e)))
  await mp.goto(URL, { waitUntil: "networkidle" })
  await settle(mp)
  report.mobile.overflow = await mp.evaluate(overflow)
  report.mobile.height = await mp.evaluate(() => document.body.scrollHeight)
  report.mobile.reveal = await mp.evaluate(() => ({ total: document.querySelectorAll(".reveal").length, inn: document.querySelectorAll(".reveal.in").length }))
  report.mobile.navLinksVisible = await mp.locator(".nav nav a").first().isVisible()
  await mp.screenshot({ path: path.join(OUT, "qa-mobile.png"), fullPage: true })
  const g = mp.locator('.concept[data-key="gateway"]')
  await g.locator('.seg[data-role="bg"] button[data-val="paper"]').click()
  await g.locator('.seg[data-role="view"] button[data-val="lockup"]').click()
  await g.scrollIntoViewIfNeeded()
  await mp.waitForTimeout(400)
  await g.screenshot({ path: path.join(OUT, "qa-mobile-card.png") })
  report.mobile.cardOverflow = await mp.evaluate(overflow)
  await mctx.close()
  await browser.close()
  fs.writeFileSync(path.join(OUT, "qa-report.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
})().catch((e) => { console.error("QA FAILED", e); process.exit(1) })
