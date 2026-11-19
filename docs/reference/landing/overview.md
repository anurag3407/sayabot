# Public Landing Site (`apps/landing`)

`apps/landing` is the standalone public marketing site: one dark, animated page about Sayabot's remote agents, built as a fully static Next.js export (`out/`) with no server, sign-in, API or app code. Every call to action is a link: a release download, the hosted web app, or GitHub. Rooms appear as one feature among many; the page leads with agents that each have a job, their own computer and your tools, and that ask before anything risky.

Source files: `apps/landing/next.config.ts`, `apps/landing/package.json`, `apps/landing/src/app/{layout,page}.tsx`, `apps/landing/src/lib/{links,motion}.ts`, `apps/landing/src/components/*`, `apps/landing/src/styles/{base,hero,sections,homes,story}.css`, `apps/landing/public/*`.

## Running and building

| Command | What it does |
| :-- | :-- |
| `pnpm --filter @sayabot/landing dev` | Next dev server on port 3100 |
| `pnpm --filter @sayabot/landing build` | Static export to `apps/landing/out/` (deploy anywhere: Cloudflare Pages, nginx, S3) |
| `pnpm --filter @sayabot/landing typecheck` / `lint` | `tsc --noEmit` / `eslint src` |

`next.config.ts` sets `output: "export"`, `images.unoptimized`, and `transpilePackages: ["@sayabot/core"]`. Turbo caches `out/**` for `build`.

Build-time env (both optional):

| Variable | Default | Used for |
| :-- | :-- | :-- |
| `NEXT_PUBLIC_APP_URL` | `https://sayabot.sayalabs.in` | Web app links (`/login`, `/signup`, `/privacy`, `/terms`, `/security`) |
| `NEXT_PUBLIC_SITE_URL` | `https://sayabot.tech` | `metadataBase` for Open Graph URLs |

## Deployment & CI/CD

`apps/landing` is hosted on **Cloudflare Pages** at `https://sayabot.tech` (project `sayabot`, custom domains `sayabot.tech`, `www.sayabot.tech`, and `bot.sayalabs.tech`).

- **Automated CI/CD**: Managed by `.github/workflows/landing-deploy.yml`. On push to `main` touching `apps/landing/**`, `packages/core/**`, or `pnpm-lock.yaml`, GitHub Actions builds the static export (`out/`) and deploys via Wrangler using repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- **Manual deploy**:
  ```bash
  CLOUDFLARE_API_TOKEN="..." CLOUDFLARE_ACCOUNT_ID="..." npx wrangler pages deploy apps/landing/out --project-name=sayabot --branch=main
  ```

## Links (`src/lib/links.ts`)

`LINKS` holds every outbound destination (web app, GitHub repo, latest release page, sponsor, self-hosting guide, docs, issues, licensing). `DOWNLOADS` maps `macArm`, `macIntel`, `winX64`, `winArm`, `android` to `https://github.com/anurag3407/sayabot/releases/latest/download/<file>` (`Sayabot-arm64.dmg`, `Sayabot-x64.dmg`, `Sayabot-Setup-x64.exe`, `Sayabot-Setup-arm64.exe`, `Sayabot.apk`) with a label, detail line and platform. Change a destination there, once.

## Sections (`src/app/page.tsx`)

1. **Nav** (`nav.tsx`, `launch-banner.tsx`): Top launch announcement ribbon (`v1.0 Launch` pulse dot, release tagline, "Quick Links & Downloads" trigger with animated chevron, GitHub star button, and dismissible state). Clicking the trigger expands the **Launch Hub Matrix** (Native Apps for Mac/Windows/Android/Web, Key Innovations, Deployment & Specs, and Community & Source links with <kbd>Esc</kbd> shortcut). Main bar contains the Saya mark whose eyes follow the pointer, section anchors (`#agents`, `#mascots`, `#how`, `#computer`, `#features`, `#download`), GitHub, and "Open web app". Gains a blurred background after 12px of scroll.
2. **Hero** (`hero.tsx`): headline words drop in on a spring with a rotating last phrase ("asleep / offline / in meetings / on a flight / with family"). Then the platform-aware split download button (`download-button.tsx`: detects Mac / Windows (ARM64) / Android from the user agent; the menu lists every build) and the Self-host link. `.hero-ctas` is `position: relative; z-index: 4` so the open menu paints above the lineup; the row's entrance animation uses a transform, which would otherwise trap the menu underneath the cast. `.final-ctas` uses the same stacking for the closing download menu. Below that is the **lineup** (`#mascots`): seven cast members on a lit floor in front of a giant outlined "sayabot", each cycling through real agent states with a status pill ("Send 3 reminders?", "Running 48 tests", "Next run Mon 6:00"). All their eyes follow the pointer, and hovering one makes it smile.
3. **Agent window** (`agent-window.tsx`): a looping product demo driven by `useSequence`. Block is asked to fix a flaky test; steps stream in while its computer's terminal runs alongside; an approval card ("5 min, then no") drains, gets allowed from the phone, and the PR opens.
4. **Tools** (`tools.tsx`, `brand-logos.tsx`): an interactive **Radial Connector Constellation Hub** featuring an SVG connector canvas and circular brand app nodes (Slack, Google Calendar, Linear, Sentry, Stripe, Discord, GitHub, PostHog, Supabase, Google Drive, Notion, Gmail) orbiting a central Sayabot agent orchestration card. The card features living Sayabot mascot Scout (`<Saya shape="ghost" tone="lilac" ... />`), agent metadata with pulsing status indicator, user prompt container with inline app badges, and an interactive 4-step checklist. The active tool dynamically illuminates its orbital node with a pulsing double-ring halo, draws an animated traveling glowing beam (`stroke-dashoffset` SVG beam animation) from the card boundary to the node, and cycles through live execution states. Clicking any checklist step or any surrounding app node dynamically switches the focus, routes the beam, and updates the card. A marquee of agent clients (Claude Code, Codex, Cursor, Gemini CLI, Hermes, OpenCode, Qwen Code, Copilot, ChatGPT) runs underneath over one MCP invite link. Gracefully reflows into a mobile-optimized view on small screens (<720px).
5. **Jobs** (`jobs.tsx`, `#agents`): interactive tabs for six jobs (Support triage, Bookkeeper, Engineer, Research, Chief of Staff, Growth & SEO) with runs / uses / asks-you metadata and an iPhone Pro chassis chat mockup (featuring an authentic Space Black titanium frame, antenna bands, side physical action/volume/power buttons, top speaker ear-piece slit, Dynamic Island pill with sensor dot and anti-reflective camera lens reflections, OLED screen bezel, and bottom home indicator bar) that replays. Autoplays every 9 s until clicked.
6. **How it works** (`how.tsx`, `#how`): four CSS-animated scene cards (hire, computer, schedule, approve) that only animate while on screen.
7. **Computer** (`computer.tsx`, `#computer`): a 3-column modular card showcase covering execution topology: (1) **Dedicated sandboxes** (MacBook Pro 'This Mac', build-box 'Over SSH', cloud-vps 'Docker Daemon' with live pointer-tracking Sayabot mascots Block, Saya, Sprout, and Ledger), (2) **Any agent engine** (MCP gateway status bar with Claude Code, Codex, Gemini CLI, Cursor, Copilot, OpenCode cards), and (3) **Your subscription** (AGPL-3.0 open source $0 card highlighting zero markup, direct provider billing to Anthropic/OpenAI, and self-hosting).
8. **Flow** (`flow.tsx`): an SVG architecture diagram (you → Sayabot → agent computers → tools) with SMIL `animateMotion` comets; an amber comet carries approvals back to the phone. Scrolls horizontally inside its box under 860px.
9. **Features** (`features.tsx`, `#features`): bento of bring-your-own-model, schedules, sealed secrets, audit log, messaging channels, and rooms (turn halo passing between seats).
10. **Memory** (`memory.tsx` + `styles/story.css`, `#memory`): "They still know in the morning." A recall card cycles four notes (preference, decision, open promise, private fact) with `useSequence([3200, 3200, 3200, 3200])` while in view. Copy covers the three scopes (agent, room, workspace), answers kept as facts, and notes mirrored onto the computer.
11. **Decisions** (`decisions.tsx`, `#decisions`): "Risky things wait for a yes." Three slips (approval, question, stopped command) dim until the sequence highlights one. Copy: the turn pauses for anything that sends, deletes, spends or leaves the machine; the same ask reaches the phone, inbox and chat; five quiet minutes counts as a no.
12. **Tasks** (`board.tsx`, `#tasks`): a four-column board (Open, Doing, Stuck, Done). One card, SAYA-18, moves across the columns on `useSequence([2600, 2600, 2800, 3200])`, ending on an outcome. A caption under the board narrates the step.
13. **The day** (`day.tsx`, `#day`): a tablist of a sample day (9:00 morning, 11:40 check-in, 2:15 question, 5:00 evening, 3:00 overnight). Auto-advances every 4.2 s while in view until a row is clicked; reduced motion does not autoplay. The note states morning 9:00 and evening 5:00 are the room defaults.
14. **Homes** (`homes.tsx` + `styles/homes.css`, `#homes`): "Where your agents live." Three cards (on your Mac, on Sayabot Cloud, on your own server), each a sky scene with a notification panel and a status row. `useSequence([4200, 5200])` loops day → night while in view: the sky fades to stars and the sun sets for the moon; the Mac card's pill turns Asleep and its agents switch to the `sleeping` mood; the Cloud and server cards stay awake and an overnight notification (`3:00 AM`) slides in at the top. The Cloud card lists every hosted feature with a **Coming soon** label and has no signup link; its status pill reads "Coming soon". Mac links to `#download`. The server card links to `LINKS.selfHost`. The FAQ answer for where work runs says the Mac app and a server you host work today, and Sayabot Cloud is coming soon.
15. **Questions** (`faq.tsx`, `#faq`): six `<details>` rows (timeout, facts, sealed keys, where work runs, models, AGPL self-hosting). The `name="faq"` attribute keeps one row open at a time.
16. **Downloads** (`downloads.tsx`, `#download`): Mac, Windows, Android and Web cards plus an open-source / self-host panel with the clone commands.
17. **Final CTA** (`final-cta.tsx`): Saya draws itself in outline (`stroke-dashoffset`), fills, opens its eyes and watches the pointer.
18. **Footer** (`footer.tsx`): link columns and a giant faded wordmark with Hoot peeking out. Product column includes `#memory` and `#faq`.

## Motion system

- `src/lib/motion.ts`: `useInView` (IntersectionObserver, optional `once`), `useSequence(durations, active)` (loops step indexes only while visible; reduced motion jumps to the last step), and `useLookAt(svgRef)` (one shared rAF-throttled `pointermove` listener that sets `--lx`/`--ly` on each mascot; fine pointers only).
- `reveal.tsx`: fades and lifts content the first time it scrolls into view (`.reveal.is-in`, staggered by `--i`).
- `saya.tsx`: the landing's mascot renderer over `@sayabot/core/mascot`, with `follow`, `live` (bob + blink), `lit` (turn halo) and `pool`.
- Easing tokens in `base.css`: `--spring` `cubic-bezier(.2, 1.6, .4, 1)` for pops and `--soft` `cubic-bezier(.22, 1, .36, 1)` for reveals. A conic `.beam` light runs around the demo window's border. `prefers-reduced-motion` disables animations and shows revealed content immediately.

## Assets

`public/icon.svg`, `favicon.ico`, `apple-touch-icon.png` and `og.png` (1200×630 cast card) are generated by `pnpm --filter @sayabot/web brand:icons`; do not edit them by hand.

## SEO, AI Search (GEO) & Browser Tabs

`apps/landing` is optimized for search engines, AI search engines (Perplexity, ChatGPT Search, Claude, Gemini), and browser tab rendering:
- **Browser Tab Lifecycle** (`src/components/tab-title.tsx`): On document `visibilitychange`, inactive tabs show `"⚡ Still working while you're away... | Sayabot"`. On refocus, briefly displays `"👋 Welcome back! | Sayabot"` before restoring the primary title.
- **PWA Manifests**: `public/site.webmanifest` and `public/manifest.json` configured with standalone display and theme color `#08080a`.
- **Structured Data (JSON-LD)**: 4 active schemas embedded in `src/app/layout.tsx`: `WebSite` (canonical URL `https://sayabot.tech`), `Organization` (Sayalabs), `SoftwareApplication` (Sayabot v1.0.0, price $0, multi-OS), and `SoftwareSourceCode` (GitHub repository). Restricted `FAQPage` schema is omitted per Google Search policy.
- **Robots & Crawlers** (`public/robots.txt`): Explicit policies for 11 AI crawlers (allowing `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `Applebot-Extended`, `anthropic-ai`, `Amazonbot`, `FacebookBot`; blocking scrapers `Bytespider`, `CCBot`) plus Googlebot/Bingbot/DuckDuckBot/Applebot, with Sitemap and Host directives.
- **XML Sitemap** (`public/sitemap.xml`): Priority-weighted section links.
- **AI Search Readiness (GEO/AEO)** (`public/llms.txt` and `public/llms-full.txt`): Compliant with the `llmstxt.org` specification (100/100 audit score) for agentic citation and indexing.
- **Security & Caching Headers** (`public/_headers`): Cloudflare Pages deployment rules for HSTS, CSP frame protection, X-Content-Type-Options nosniff, Referrer-Policy, and immutable asset cache headers.

## Related docs

- [core/mascot](../core/mascot.md): the shared mascot geometry
- [web/pages/landing-page](../web/pages/landing-page.md): the older in-app landing at `/` in the web app
- [web/pages/ui-shell-and-kit](../web/pages/ui-shell-and-kit.md): brand and icon export scripts
