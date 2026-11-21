# Public Landing Site (`apps/landing`)

`apps/landing` is the standalone public marketing site: one dark, animated page about Sayabot's remote agents, built as a fully static Next.js export (`out/`) with no server, sign-in, API or app code. Every call to action is a link: a release download, the hosted web app, or GitHub. Rooms appear as one feature among many; the page leads with agents that each have a job, their own computer and your tools, and that ask before anything risky.

Source files: `apps/landing/next.config.ts`, `apps/landing/package.json`, `apps/landing/src/app/{layout,page}.tsx`, `apps/landing/src/app/self-host/page.tsx`, `apps/landing/src/lib/{links,motion,self-host-prompt}.ts`, `apps/landing/src/components/*`, `apps/landing/src/styles/{base,hero,sections,homes,story,self-host}.css`, `apps/landing/public/*`.

## Running and building

| Command                                             | What it does                                                                        |
| :-------------------------------------------------- | :---------------------------------------------------------------------------------- |
| `pnpm --filter @sayabot/landing dev`                | Next dev server on port 3100                                                        |
| `pnpm --filter @sayabot/landing build`              | Static export to `apps/landing/out/` (deploy anywhere: Cloudflare Pages, nginx, S3) |
| `pnpm --filter @sayabot/landing typecheck` / `lint` | `tsc --noEmit` / `eslint src`                                                       |

`next.config.ts` sets `output: "export"`, `images.unoptimized`, and `transpilePackages: ["@sayabot/core"]`. Turbo caches `out/**` for `build`.

Build-time env (both optional):

| Variable               | Default                                         | Used for                                                               |
| :--------------------- | :---------------------------------------------- | :--------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`  | `http://localhost:7431` (or self-hosted domain) | Web app links (`/login`, `/signup`, `/privacy`, `/terms`, `/security`) |
| `NEXT_PUBLIC_SITE_URL` | `https://sayabot.tech`                          | `metadataBase` for Open Graph URLs                                     |

## Deployment & CI/CD

`apps/landing` is hosted on **Cloudflare Pages** at `https://sayabot.tech` (project `sayabot`, custom domains `sayabot.tech`, `www.sayabot.tech`, and `bot.sayalabs.tech`).

- **Automated CI/CD**: Managed by `.github/workflows/landing-deploy.yml`. On push to `main` touching `apps/landing/**`, `packages/core/**`, or `pnpm-lock.yaml`, GitHub Actions builds the static export (`out/`) and deploys via Wrangler using repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- **Manual deploy**:
  ```bash
  CLOUDFLARE_API_TOKEN="..." CLOUDFLARE_ACCOUNT_ID="..." npx wrangler pages deploy apps/landing/out --project-name=sayabot --branch=main
  ```

## Links (`src/lib/links.ts`)

`LINKS` holds every outbound destination (web app, GitHub repo, latest release page, sponsor, docs, issues, licensing). `selfHost` is the on-site guide at `/self-host`. `selfHostDocs` and `selfHostQuickstart` still point at the long manuals in the GitHub repo. `DOWNLOADS` maps `macArm`, `macIntel`, `winX64`, `winArm`, `android` to `https://github.com/anurag3407/sayabot/releases/latest/download/<file>` (`Sayabot-arm64.dmg`, `Sayabot-x64.dmg`, `Sayabot-Setup-x64.exe`, `Sayabot-Setup-arm64.exe`, `Sayabot.apk`) with a label, detail line and platform. Change a destination there, once.

## Sections (`src/app/page.tsx`)

1. **Nav** (`nav.tsx`, `launch-banner.tsx`): Top launch announcement ribbon (`v1.0 Launch` pulse dot, release tagline, "Quick Links & Downloads" trigger with animated chevron, GitHub star button, and dismissible state). Clicking the trigger expands the **Launch Hub Matrix** (Native Apps for Mac/Windows/Android/Web, Key Innovations, Deployment & Specs, and Community & Source links with <kbd>Esc</kbd> shortcut). Main bar contains the Saya mark whose eyes follow the pointer, section anchors (`/#agents`, `/#mascots`, `/#how`, `/#computer`, `/#features`, `/#download`), GitHub, and "Open web app". The `/#` form keeps those links working from `/self-host` and the other standalone pages. Gains a blurred background after 12px of scroll.
2. **Hero** (`hero.tsx`): headline words drop in on a spring with a rotating last phrase ("asleep / offline / in meetings / on a flight / with family"). Then the platform-aware split download button (`download-button.tsx`: detects Mac / Windows (ARM64) / Android from the user agent; the menu lists every build) and the Self-host link, which goes to `/self-host`. `.hero-ctas` is `position: relative; z-index: 4` so the open menu paints above the lineup; the row's entrance animation uses a transform, which would otherwise trap the menu underneath the cast. `.final-ctas` uses the same stacking for the closing download menu. Below that is the **lineup** (`#mascots`): seven cast members on a lit floor in front of a giant outlined "sayabot", each cycling through real agent states with a status pill ("Send 3 reminders?", "Running 48 tests", "Next run Mon 6:00"). All their eyes follow the pointer, and hovering one makes it smile.
3. **Agent window** (`agent-window.tsx`): a looping product demo driven by `useSequence`. Block is asked to fix a flaky test; steps stream in while its computer's terminal runs alongside; an approval card ("5 min, then no") drains, gets allowed from the phone, and the PR opens.
4. **Self-host band** (`self-host-band.tsx`, `#self-host`): sits directly under the agent window. A centered pill, "Set up Sayabot with your agent", copies `AGENT_SETUP_PROMPT` from `src/lib/self-host-prompt.ts` and shows a "Setup prompt copied" status. The names on the pill (Cursor, Claude, Codex, Gemini) are the agents that install Sayabot. The prompt tells that agent to run `setup-vps.sh`, `./deploy/install.sh`, then `setup-computers.sh` (computers and egress are not in the default `SAYABOT_APP_SERVICES`), and to verify `/api/health`, `/api/instance` (`edition: self-hosted`), room turns, approval gates, `/collab`, and `/api/v1/mcp`. Four short checks and a link to `/self-host` sit below, with wide vertical padding. Two live mascots (Ledger and Hoot, eyes following the pointer) flank the pill on wide screens (hidden under 860px). The four checks (Workspace, Safety, Computers, Your apps) are hover-lift cards, each with its own mascot.
5. **Tools** (`tools.tsx`, `brand-logos.tsx`): an interactive **Radial Connector Constellation Hub** featuring an SVG connector canvas and circular brand app nodes (Slack, Google Calendar, Linear, Sentry, Stripe, Discord, GitHub, PostHog, Supabase, Google Drive, Notion, Gmail) orbiting a central Sayabot agent orchestration card. The card features living Sayabot mascot Scout (`<Saya shape="ghost" tone="lilac" ... />`), agent metadata with pulsing status indicator, user prompt container with inline app badges, and an interactive 4-step checklist. The active tool dynamically illuminates its orbital node with a pulsing double-ring halo, draws an animated traveling glowing beam (`stroke-dashoffset` SVG beam animation) from the card boundary to the node, and cycles through live execution states. Clicking any checklist step or any surrounding app node dynamically switches the focus, routes the beam, and updates the card. A marquee of agent clients (Claude Code, Codex, Cursor, Gemini CLI, Hermes, OpenCode, Qwen Code, Copilot, ChatGPT) runs underneath over one MCP invite link. Gracefully reflows into a mobile-optimized view on small screens (<720px).
6. **Jobs** (`jobs.tsx`, `#agents`): interactive tabs for six jobs (Support triage, Bookkeeper, Engineer, Research, Chief of Staff, Growth & SEO) with runs / uses / asks-you metadata and an iPhone Pro chassis chat mockup (featuring an authentic Space Black titanium frame, antenna bands, side physical action/volume/power buttons, top speaker ear-piece slit, Dynamic Island pill with sensor dot and anti-reflective camera lens reflections, OLED screen bezel, and bottom home indicator bar) that replays. Autoplays every 9 s until clicked.
7. **How it works** (`how.tsx`, `#how`): four CSS-animated scene cards (hire, computer, schedule, approve) that only animate while on screen and lift on hover. Under each scene a numbered badge sits on one connector line that runs across the row, then the title and body.
8. **Computer** (`computer.tsx`, `#computer`): a 3-column modular card showcase covering execution topology: (1) **Dedicated sandboxes** (MacBook Pro 'This Mac', build-box 'Over SSH', cloud-vps 'Docker Daemon' with live pointer-tracking Sayabot mascots Block, Saya, Sprout, and Ledger), (2) **Any agent engine** (MCP gateway status bar with Claude Code, Codex, Gemini CLI, Cursor, Copilot, OpenCode cards), and (3) **Your subscription** (AGPL-3.0 open source $0 card highlighting zero markup, direct provider billing to Anthropic/OpenAI, and self-hosting).
9. **Flow** (`flow.tsx`): an SVG architecture diagram (you → Sayabot → agent computers → tools) with SMIL `animateMotion` comets; an amber comet carries approvals back to the phone. Scrolls horizontally inside its box under 860px. The four column captions (You, anywhere · Sayabot · Agent computers · Your tools) are absolutely positioned at the same x as their column's nodes (96 / 450 / 715 / 915 of 1000) inside the diagram, so they cannot drift; `.flow-scroll` keeps 52px of padding for them.
10. **Features** (`features.tsx`, `#features`): bento of bring-your-own-model, schedules, sealed secrets, audit log, messaging channels, and rooms (turn halo passing between seats).
11. **Memory** (`memory.tsx` + `styles/story.css`, `#memory`): "They still know in the morning." A "Recalled for this run" card lists all four notes (preference, decision, open promise, private fact). `useSequence([3200, 3200, 3200, 3200])` highlights one at a time: that row expands with its detail and a green "used ✓". A scope strip at the bottom (This agent / This room / The workspace) lights where the note lives. Clicking a row pins it and stops the sequence. The three points beside it are numbered cards.
12. **Decisions** (`decisions.tsx`, `#decisions`): "Risky things wait for a yes." An "Inbox" device card holds three requests (approval, question, stopped command). The active one is expanded (title, detail, choices or a Denied tag, an amber countdown bar for the approval, the note) and the others collapse to one-line rows, so nothing sits dimmed. It cycles every 3.8 s; clicking a row pins it. Copy: the turn pauses for anything that sends, deletes, spends or leaves the machine; the three points are numbered cards.
13. **Tasks** (`board.tsx`, `#tasks`): a four-column board (Open, Doing, Stuck, Done). One card, SAYA-18, moves across the columns on `useSequence([2600, 2600, 2800, 3200])`, ending on an outcome. A caption under the board narrates the step.
14. **The day** (`day.tsx`, `#day`): "A room keeps office hours." Two panes: a rail of the sample day's hours (9:00 morning, 11:40 check-in, 2:15 question, 5:00 evening, 3:00 overnight), each with its mascot and a fill bar on the active hour, and a stage whose sky changes with the hour (`sky-dawn|day|ask|dusk|night`: warm sun, blue day, iris, coral dusk, a moon with twinkling stars). The stage shows the time, title and body, and the agent's live mascot posting the message it would send then. It auto-advances every 4.6 s while in view; a "Pause the day / Play the day" button and clicking an hour stop it. Under 960px the rail becomes a swipeable strip above the stage. Reduced motion holds still.
15. **Homes** (`homes.tsx` + `styles/homes.css`, `#homes`): "Where your agents live." Three cards (on your Mac, on Sayabot Cloud, on your own server), each a sky scene with a notification panel and a status row. `useSequence([4200, 5200])` loops day → night while in view: the sky fades to stars and the sun sets for the moon; the Mac card's pill turns Asleep and its agents switch to the `sleeping` mood; the Cloud and server cards stay awake and an overnight notification (`3:00 AM`) slides in at the top. The Cloud card lists every hosted feature with a **Coming soon** label and has no signup link; its status pill reads "Coming soon". Mac links to `#download`. The server card links to `LINKS.selfHost`. The FAQ answer for where work runs says the Mac app and a server you host work today, and Sayabot Cloud is coming soon.
16. **Questions** (`faq.tsx`, `#faq`): six `<details>` rows (timeout, facts, sealed keys, where work runs, models, AGPL self-hosting). The `name="faq"` attribute keeps one row open at a time.
17. **Downloads** (`downloads.tsx`, a client component, `#download`): Mac, Windows, Android and Web cards share one structure (icon tile, title, copy, then the buttons and a meta line pinned to the bottom with `margin-top: auto`, so every card's buttons line up). The visitor's OS (from `navigator.userAgent`; iPhone and iPad map to Web) gets a "For this device" chip and an accent border, and each card has a mascot that pops up on hover (always on the recommended card). The Mac terminal install (`curl -fsSL https://sayabot.sayalabs.in/install-mac.sh | bash`) is a full-width strip under the grid with Copy and "All install options" (`/download`); on phones the command wraps to its own line. Below that, the open-source / self-host panel (GitHub mark plus a Hoot) with the clone commands.
18. **Partners & Sponsors** (`partners.tsx`): showcases ecosystem partners and community sponsors below the download section. Features a community sponsorship card for open-source GitHub Sponsors with quick links, plus category pill rows for `MODELS` (Claude, OpenAI, Gemini, Hermes, DeepSeek, Grok, Ollama, Cursor) and `TOOLS AND APPS` (computerd Linux sandboxes, MCP, Cloudflare, GitHub, Slack, Linear, Composio). Includes direct action buttons for "Sponsor me" (GitHub Sponsors) and "Become a partner".
19. **Final CTA** (`final-cta.tsx`): Saya draws itself in outline (`stroke-dashoffset`), fills, opens its eyes and watches the pointer.
20. **Footer** (`footer.tsx`): link columns and a giant faded wordmark with Hoot peeking out. Product column includes `#memory` and `#faq`.

## Dedicated Download & Platform Pages (`src/app/download`, `desktop`, `apk`)

- **`/download`** (`src/app/download/page.tsx`): Standalone client download directory with interactive OS cards (Mac Apple Silicon & Intel DMGs, Windows x64 & ARM64 NSIS installers, direct Android release APK with phone QR scan code, and Web application), 1-click curl/PowerShell install commands, complete 4-platform capability matrix, and AGPL self-hosting Docker commands.
- **`/desktop`** (`src/app/desktop/page.tsx`): Canonical desktop client landing page targeting macOS and Windows installers.
- **`/apk`** (`src/app/apk/page.tsx`): Dedicated Android mobile companion APK page for direct sideloading and push approval setups.
- **`/self-host`** (`src/app/self-host/page.tsx`): Self-host guide for a VPS clone. Centered hero with the same copyable pill, then a card grid of `SELF_HOST_FEATURES` (Ready / Extra step / Off), four install cards with copyable commands, a checklist, and the full prompt inside a terminal panel. Links out to `LINKS.selfHostDocs` and `LINKS.selfHostQuickstart`. Nav and footer section links use `/#…` so they still reach the homepage from this route.

## Motion system

- `src/lib/motion.ts`: `useInView` (IntersectionObserver, optional `once`), `useSequence(durations, active)` (loops step indexes only while visible; reduced motion jumps to the last step), and `useLookAt(svgRef)` (one shared rAF-throttled `pointermove` listener that sets `--lx`/`--ly` on each mascot; fine pointers only).
- `reveal.tsx`: fades and lifts content the first time it scrolls into view (`.reveal.is-in`, staggered by `--i`).
- `saya.tsx`: the landing's mascot renderer over `@sayabot/core/mascot`, with `follow`, `live` (bob + blink), `lit` (turn halo) and `pool`.
- Spacing in `base.css`: `.section` padding is `clamp(88px, 10vw, 124px)`, and `html { scroll-padding-top: 128px }` makes anchor jumps (`/#how`, `/#download`) land below the sticky launch ribbon and nav instead of under them.
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
