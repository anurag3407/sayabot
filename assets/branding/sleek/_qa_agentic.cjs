const { chromium } = require("@playwright/test")
const fs = require("fs")
const path = require("path")
const OUT = path.join(__dirname, "renders")
const DL = path.join(OUT, "qa-agentic-downloads")
fs.mkdirSync(DL, { recursive: true })
const URL = "file://" + path.join(__dirname, "agentic.html")

const overflow = () => {
  const vw = document.documentElement.clientWidth
  const bad = []
  document.querySelectorAll("body *").forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
      const cls = (el.className.baseVal !== undefined ? el.className.baseVal : el.className) || ""
      bad.push({ tag: el.tagName, cls: String(cls).slice(0, 24), id: el.id, right: Math.round(r.right) })
    }
  })
  return { vw, scrollW: document.documentElement.scrollWidth, count: bad.length, bad: bad.slice(0, 10) }
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
  const report = { console: [], pageerrors: [], desktop: {}, mobile: {}, steps: [] }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage()
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") report.console.push(m.type() + ": " + m.text()) })
  page.on("pageerror", (e) => report.pageerrors.push(String(e)))
  await page.goto(URL, { waitUntil: "load" })
  await page.waitForTimeout(1200)
  await settle(page)
  report.desktop.overflow = await page.evaluate(overflow)
  report.desktop.reveal = await page.evaluate(() => ({ total: document.querySelectorAll(".reveal").length, inn: document.querySelectorAll(".reveal.in").length }))
  report.desktop.markPaths = await page.evaluate(() => document.querySelectorAll("#mark svg path").length)
  await page.screenshot({ path: path.join(OUT, "qa-agentic-desktop.png"), fullPage: true })
  await page.locator(".stage").screenshot({ path: path.join(OUT, "qa-agentic-stage.png") })

  const svgBefore = await page.locator("#mark").innerHTML()
  // taper slider live
  await page.locator("#c-taper").fill("100")
  const svgTaper = await page.locator("#mark").innerHTML()
  report.steps.push({ step: "taper 100", changed: svgTaper !== svgBefore, out: (await page.locator("#o-taper").textContent()).trim() })
  // echoes
  await page.locator("#c-echoes").fill("4")
  report.steps.push({ step: "echoes 4", circles: await page.locator("#mark svg circle").count(), out: (await page.locator("#o-echoes").textContent()).trim() })
  // surface + colour
  await page.locator("#c-surface").selectOption("paper")
  await page.locator("#c-colour").selectOption("ink")
  report.steps.push({ step: "paper+ink", stageBg: await page.locator("#stage").getAttribute("data-bg"), fill: await page.locator("#mark svg path").first().getAttribute("fill") })
  await page.locator("#c-surface").selectOption("void")
  await page.locator("#c-colour").selectOption("brand")
  // toggles
  await page.locator("#c-grid").check()
  report.steps.push({ step: "grid", on: await page.locator("#gridOv").evaluate((e) => e.classList.contains("on")) })
  await page.locator("#c-grid").uncheck()
  await page.locator("#c-spin").uncheck()
  const r1 = await page.locator("#mark svg #rot").getAttribute("transform")
  await page.waitForTimeout(400)
  const r2 = await page.locator("#mark svg #rot").getAttribute("transform")
  report.steps.push({ step: "spin off stable", stable: r1 === r2 })
  await page.locator("#c-spin").check()
  await page.waitForTimeout(400)
  const r3 = await page.locator("#mark svg #rot").getAttribute("transform")
  report.steps.push({ step: "spin on moves", moves: r3 !== r2 })
  // presets
  await page.locator('[data-preset="classic"]').click()
  report.steps.push({ step: "preset classic", taperOut: (await page.locator("#o-taper").textContent()).trim(), echoesOut: (await page.locator("#o-echoes").textContent()).trim() })
  await page.locator('[data-preset="agentic"]').click()
  // randomize + reset
  await page.locator("#rand").click()
  const randGap = await page.locator("#c-gap").inputValue()
  await page.locator("#reset").click()
  report.steps.push({ step: "randomize+reset", randGap, resetGap: await page.locator("#c-gap").inputValue() })
  // exports
  const [dlSvg] = await Promise.all([page.waitForEvent("download"), page.locator("#dlSvg").click()])
  const svgPath = path.join(DL, dlSvg.suggestedFilename())
  await dlSvg.saveAs(svgPath)
  report.steps.push({ step: "download svg", file: dlSvg.suggestedFilename(), bytes: fs.statSync(svgPath).size })
  await page.locator("#cpSvg").click()
  await page.waitForTimeout(300)
  report.steps.push({ step: "copy svg", toast: (await page.locator("#toast").textContent()).trim() })
  const [dlPng] = await Promise.all([page.waitForEvent("download"), page.locator("#dlPng").click()])
  const pngPath = path.join(DL, dlPng.suggestedFilename())
  await dlPng.saveAs(pngPath)
  report.steps.push({ step: "download png", file: dlPng.suggestedFilename(), bytes: fs.statSync(pngPath).size })
  // theme
  await page.locator("#themeToggle").click()
  await page.waitForTimeout(300)
  report.steps.push({ step: "theme", theme: await page.evaluate(() => document.documentElement.dataset.theme) })
  await page.screenshot({ path: path.join(OUT, "qa-agentic-light.png") })
  await page.locator("#themeToggle").click()
  // nav anchor
  await page.locator('.nav nav a[href="#variants"]').click()
  await page.waitForTimeout(900)
  report.steps.push({ step: "nav anchor", active: await page.evaluate(() => (document.querySelector(".nav nav a.active") || {}).getAttribute ? document.querySelector(".nav nav a.active").getAttribute("href") : null), top: await page.evaluate(() => Math.round(document.getElementById("variants").getBoundingClientRect().top)) })
  await ctx.close()

  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true })
  const mp = await mctx.newPage()
  mp.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") report.console.push("mobile " + m.type() + ": " + m.text()) })
  mp.on("pageerror", (e) => report.pageerrors.push("mobile " + String(e)))
  await mp.goto(URL, { waitUntil: "load" })
  await mp.waitForTimeout(1000)
  await settle(mp)
  report.mobile.overflow = await mp.evaluate(overflow)
  report.mobile.reveal = await mp.evaluate(() => ({ total: document.querySelectorAll(".reveal").length, inn: document.querySelectorAll(".reveal.in").length }))
  report.mobile.navVisible = await mp.locator(".nav nav a").first().isVisible()
  report.mobile.panelVisible = await mp.locator("#panel").isVisible()
  await mp.screenshot({ path: path.join(OUT, "qa-agentic-mobile.png"), fullPage: true })
  await mp.locator("#c-taper").fill("80")
  report.mobile.sliderWorks = (await mp.locator("#o-taper").textContent()).trim() === "80%"
  await mctx.close()
  await browser.close()
  fs.writeFileSync(path.join(OUT, "qa-agentic-report.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
})().catch((e) => { console.error("QA FAILED", e); process.exit(1) })
