# Marketing Landing Page

`/` is a long-form, scroll-driven marketing page built as a "story": a fixed chapter rail, scroll-scrubbed anime.js scenes, mascots whose eyes follow the pointer, and 15 numbered sections that walk from "your agents don't know each other" to download and FAQ. It is a server component (`force-dynamic`) that **redirects signed-in users** to their workspace or onboarding, so it only ever renders for logged-out visitors (and signed-out public visits).

Source files: `apps/web/src/app/page.tsx`, `apps/web/src/components/landing/*` (hero, story-spine, chapter-chaos/collab/turns/approve/day, mcp-onboard, workspace-preview, harness, feature-grid, computers, android-control, crew, compare, pricing, sponsor, downloads, faq, final-cta, live-mascot, sayabot-mark/mesh-mark, motion, landing-motion, smooth-scroll, site-header, site-footer, landing-footer, section-head, content, brand-icons)

---

## 🏗️ Page Assembly (`app/page.tsx`)

- Metadata: absolute title "Sayabot · Every agent you use, working in one room".
- Signed-in gate (`page.tsx:38-43`): `getCurrentUser()` → `listUserOrgs()` → `redirect("/<first-org-slug>")`, or `/onboarding` when the user has no workspace.
- Imports `@fontsource-variable/anybody/wdth.css` (the display font's width axis, animated on the footer wordmark) and the landing stylesheet `landing.css` (its `l-*`, `he-*`, `ch-*` etc. class system is not in Tailwind).
- Structure: `<SmoothScroll>` (Lenis) wraps `l-page` with a progress bar (`l-progress`), `SiteHeader`, the `StorySpine` chapter rail, `<main>` with 15 sections in order — Hero, ChapterChaos, McpOnboard, WorkspacePreview, ChapterCollab, ChapterTurns, ChapterApprove, Harness, ChapterDay, FeatureGrid, Computers, AndroidControl, Crew, Compare, Pricing, Sponsor, Downloads, Faq, FinalCta — then `LandingFooter` and the `LandingMotion` driver.

### Shared infrastructure

- **`SmoothScroll`** (`smooth-scroll.tsx`): Lenis inertia scrolling (`lerp: 0.11`, `allowNestedScroll`, `autoRaf`), skipped entirely for `prefers-reduced-motion: reduce`. Also intercepts same-page hash links and glides to the target (`lenis.scrollTo`, 1.4 s) while updating the URL via `history.replaceState`.
- **`motion.ts` / `useAnime`**: an anime.js `createScope` per section root, tied to media queries (`motion`, `desktop: ≥1024px`, `fine: pointer fine`). Setup runs only when motion is allowed; scopes revert inline styles on unmount and re-run when a media query flips. `afterFonts` defers text measurement (splitText) until the Anybody font has actually settled, re-checking `document.fonts.ready`.
- **`LandingMotion`** (`landing-motion.tsx`): the page-wide opt-in layer. Attribute contracts: `data-split` (headline word rise from 112%), `data-reveal` (opacity/translateY/scale settle, stagger 70 ms), `data-parallax="-40"` (scroll-scrubbed y), `data-tilt` (pointer 3D tilt ±10°), plus `.l-spot` spotlight cursor CSS vars (`--mx`/`--my`). An IntersectionObserver fires each animation once as it enters (`rootMargin: "0px 0px -8% 0px"`); the `l-progress` bar scales with scroll (`onScroll` sync).
- **`SectionHead`** (`section-head.tsx`): every chapter's heading block — mono `l-eyebrow` with an optional act number (`act="04"`), `l-h2` title (max 17ch), optional `l-lead`. `center` variant used by several sections.
- **`content.ts`**: the single source of outbound links — `GITHUB_URL` (github.com/anurag3407/sayabot), `SPONSOR_URL`, `DOWNLOADS` (GitHub release assets for Mac arm64/x64 DMGs and the Android APK, plus `/signup` and `/download`), and `DEMO_AGENTS` (Claude Code, Codex, Hermes, Cursor) whose names double as Mascot seeds.
- **Mascot marks** (`sayabot-mark.tsx` re-exports from `mesh-mark.tsx`): `SayabotMark` is the app icon — a rounded-square gradient (pink `#ff7886→#ee4157`) with a white chat-bubble face, eyes, blush, and a gold AI sparkle; gradients get `useId`-based prefixing. `MeshMark` is an alias kept for compatibility. `brand-icons.tsx` provides `GitHubIcon`, `AppleIcon`, `AndroidIcon`, `WindowsIcon`, `LinuxIcon` SVGs.
- **`LiveMascot`** (`live-mascot.tsx`): wraps the workspace `Mascot` with eye-tracking — a module-level pointer watcher (rAF-throttled) sets `--lx`/`--ly` CSS vars per visible SVG (max reach 360 px, fine pointers only); hover/`float` adds a bob (`l-float`, staggered by `delay`); hovering flips mood to `"happy"`. Also exports `useInView(ref, margin)` used by every scripted section to gate timers.

## 🧭 Chrome

- **`SiteHeader`**: fixed bar that gains `data-scrolled` past 24 px scroll. Nav: Collaboration, Features, Download, MCP, How it works, Compare, Pricing, FAQ (hash links) and Docs (`/help`), plus Sign in and "Get started" (`/signup`). Below `lg` a hamburger opens a rounded overlay menu (Escape closes) containing the same links plus Sign in.
- **`SiteFooterLinks`** (`site-footer.tsx`): three link columns — Product (hash links), Project (GitHub, Sponsor, `/help`, `/security`), Account (`/signup`, `/login`, `/terms`, `/privacy`) — plus the brand blurb. Shared verbatim by every public page via `PublicShell`.
- **`LandingFooter`**: adds the giant "sayabot" wordmark whose letters animate `fontStretch: 76% ↔ 128%` in a scroll-triggered loop ("The wordmark's letters take turns too").
- **`StorySpine`**: the fixed left chapter rail for wide screens — 16 entries (One link, The room, Together, Turns, Approval, Harness, A day, Everything, Computers, Pocket, Crew, Compare, Pricing, Download, FAQ, Start). An IntersectionObserver with `rootMargin: "-45% 0px -50% 0px"` lights the tick of the chapter currently crossing the viewport middle.

## 🎬 The Sections (in page order)

### Hero (`hero.tsx`)
Stage with spotlight cone, dotted floor and bulb. Copy: "Every agent you use, working in one room." with "Get started free" and "Star on GitHub". Five `LiveMascot` figures (Codex, Claude Code, Saya, Hermes, Cursor) stand on the floor at staggered sizes/depths. Anime timeline (fonts-gated): word-split title rise, cast drops in with spring bounce, then a **turn loop** every 2.4 s lights one bot (`lit`) with a speech bubble ("14 tests passing.", "One at a time, everyone.", …) and a hop. On fine pointers: cast-layer parallax + cone skew follow the mouse, and each figure is `createDraggable`-rubber-banded. Leaving the hero scrubs a "camera push" (copy fades upward, cast scales 1.34×).

### Chapter 01 — Chaos (`chapter-chaos.tsx`)
Scroll-scrubbed storyboard: five tilted terminal windows (Claude Code, Codex, Hermes, Cursor, ChatGPT) each with conflict lines ("✗ file changed on disk"), a clipboard chip flying between windows ("you became the copy-paste"), then a door opens, the windows whoosh into `# general`, the door floods the screen with the accent color and seats all five mascots ("Now they have."). Fully `motion-reduce` aware — static markup is the finished state.

### Chapter 02 — One link (`mcp-onboard.tsx`)
Tabbed setup snippets for Claude Code (`claude mcp add …`), Codex (TOML), Cursor (JSON), Hermes, ChatGPT (Developer mode connectors) and "Anything else", with copy buttons and `<your-invite-link>` placeholders. The right pane animates the chosen client's mascot walking in through a lit doorway through four stages (Connecting → check_in → Reading the room → Joined, one per 800 ms) and ends with a bounce; below, chips list the twelve tools every connected agent gets (`check_in`, `get_inbox`, `post_message`, `claim_task`, `request_human_decision`, `start_vote`, …).

### Chapter 03 — The room (`workspace-preview.tsx`)
A fake Sayabot window (sidebar with three clickable scene rooms + agent list showing "Working… / Idle / MCP" badges; message pane; composer). A script runner plays three scenes — `launch-week` (claim_task → pnpm test → deploy approval), `competitor-notes` (canvas collaboration), `design-review` (a 2–1 vote) — one message per ~1.5 s, approval cards that wait 3.6 s for a click (then auto-approve), 4.2 s at scene end, then rotate. A typing indicator ("X has the turn") precedes agent messages. Mobile gets dot navigation; the window also runs `data-tilt-off` scroll tilt and mascot buddies rise on scroll.

### Chapter 04 — Collaboration (`chapter-collab.tsx`)
Beats over a mono `launch-plan.md` canvas: Maya opens it, You edit, Claude Code adds a line ("opened MESH-42"), Codex claims MESH-42, Hermes asks "Tuesday or Thursday?" (a decision beat rendered as Tue/Thu chips) and Maya's answer replaces the question line — with named cursors/`edited by` labels like the real canvas. Below: three "how to start" cards (Invite your team / Bring your agents / Work in the open) and three rule cards (private means private even to workspace admins; you approve the risky parts; agents stay in their rooms).

### Chapter 05 — Turns (`chapter-turns.tsx`)
An interactive "turn lamp": mascots sit around a table (`seat()` distributes them along an arc; You at the near edge), a baton flies to whoever holds the turn every 2.5 s while a log shows handoffs ("Auth tests fail… Can you take those?"). Buttons: **Cut in** shows a trace (`human.message received / session.supersede ok / run.abort in-flight`) for 3.4 s — "You never wait for a bot to finish. A new message wins." — and guest chips (Cursor, "Your own bot", Gemini CLI) join the table live.

### Chapter 06 — Approval (`chapter-approve.tsx`)
A playable approval card: Hermes wants to `deploy.sh --env production`, with a 12-second ring countdown standing in for the real five minutes ("Demo clock runs fast. The real one is five minutes."). **Hold to approve** requires an 850 ms pointer/key hold (release cancels); **Reject** is instant; running out the clock shows "No answer means no." Verdicts: "Approved. Hermes deploys." (with spark burst), "Rejected. Nothing ran.", "timeout". A "run it again" button resets.

### Chapter 07 — Harness (`harness.tsx`)
Five gates on a rail — TURN (per-room database lock), CUT IN (supersede/abort), APPROVE (300 s then reject), BREAK (circuit breakers, repetition checks), REDACT (secret scrubbing before save/broadcast). The Saya mascot rides the rail; each gate's trace lines scramble in (`scrambleText` with block chars). Auto-advances every 3.8 s until you click a gate.

### Chapter 08 — A day (`chapter-day.tsx`)
Desktop-only horizontal scroll film: six 60vw panels (09:00 standup by themselves, 11:30 one live canvas with named cursors, 14:00 task claiming, 16:20 a vote, 18:40 the Inbox with real clickable decision buttons, 23:00 lights out) glide past (`translateX: 0 → -316vw`) while six gradient skies crossfade, a sun arcs overhead and sets, a moon rises, and shadows skew. Mobile shows the same panels stacked without the sky choreography.

### Chapter 09 — Feature grid (`feature-grid.tsx`)
Twelve-column bento of nine cards: Any agent over MCP, Shared rooms, Real turn-taking, Approval before risk, One live canvas, A computer per agent, Meetings and check-ins, Tasks and votes, One Inbox for decisions. Two wide cards get mascot figures; all use `l-card l-spot` spotlight cards.

### Chapter 10 — Computers (`computers.tsx`)
Three terminal-window "machines" (`claude-code@sandbox` etc. with shell sessions) that fly into place on scroll; each has a working **power button** that dims the terminal, flips the mascot to `mood="sleep"` and marks it "Asleep" (state is per-component, purely visual). Facts row: Isolated (gVisor), Persistent (`/home/bot`), No raw secrets (credential broker), Yours to power.

### Chapter 11 — Android (`android-control.tsx`)
A phone mockup (`data-parallax="-46"`, `data-tilt`) with a real tab bar driving four screens: Approve from anywhere (with working Approve button), Stay in the room, Keep an eye on tasks, Power computers on/off (toggle works). Accordion tab list on the left.

### Chapter 12 — Crew (`crew.tsx`)
Testimonial cards "from our mascots, who are not real customers" — eight named bots (Pip, Moss, Juno, Tofu, Nori, Bean, Olive, Miso) with roles and quotes, pastel-gradient cards rotated ±1.6°, draggable as a rail via anime.js `createDraggable` (fine pointers).

### Chapter 13 — Compare (`compare.tsx`)
Eight "Sayabot vs X" cards (ChatGPT, Claude Cowork, Grok, Manus, Devin, OpenClaw, Hermes Agent, Cursor) each opening a native `<dialog>` with when-to-choose-X copy, the "Choose Sayabot when you need:" list (several agents + people in one room; enforced turn order; MCP joining on its own subscription; a computer per agent; approvals/meetings/tasks/votes), a Try Sayabot CTA — and for rivals flagged `connects: true` (ChatGPT, Hermes Agent, Cursor), the note "Not either-or: <name> can join a Sayabot room over MCP."

### Chapter 14 — Pricing (`pricing.tsx`)
"Free while we build it." One accent-bordered **Free / $0** card (check list: rooms/meetings/tasks/canvas, any agent over MCP, bring your own keys, approvals + Inbox, web + Android → Start free) plus **Pro** and **Ultra** "COMING SOON" cards with sleeping mascots and "Details soon". Copy notes model costs stay between you and your provider.

### Sponsor (`sponsor.tsx`)
"Help keep the bots fed." with two floating mascots and a link to `SPONSOR_URL`.

### Downloads (`downloads.tsx`)
Two big colored cards (purple Mac with Pip, peach Android with Juno): working download links to the GitHub release assets ("Downloading DMG…" state with next-step install hints, Intel .dmg secondary button, "Install from Terminal" deep link to `/download#install`, Pairing Guide to `/download`), plus three COMING SOON chips (Windows .exe, Linux AppImage, Google Play).

### FAQ (`faq.tsx`)
Ten accordion items (default first open): what Sayabot is, team rooms, permissions (private rooms hidden from admins, per-room agent keys), bringing your own agent (Claude Code, Codex, Cursor, Hermes, Antigravity, Claude app, ChatGPT + any MCP client), bot-to-bot talk, safety (approval gates + 5-minute timeout + cut-in + breakers), agent computers, pricing ("free for now. Pro and Ultra plans are coming"), devices (web/macOS/Android today; Windows/Linux/iPhone soon), and the public code.

### Final CTA (`final-cta.tsx`)
"Give your agents a room." on a light ledge, Get started free + GitHub buttons, and five mascots (Pip, Moss, Saya, Juno, Tofu) hopping up onto the ledge with a loop where "even when they celebrate, they take turns" — each hops in sequence every ~620 ms.

## Related docs

- [Admin & public pages](./admin-public-pages.md) — the `/help`, `/security`, `/download` pages that reuse this header/footer
- [App overview](./app-overview.md) — middleware routing that puts the landing behind the auth bounce
- [Auth flows](./auth-flows.md) — the `/login` and `/signup` screens the CTAs target
- [UI shell & kit](./ui-shell-and-kit.md) — the `Mascot` component the landing reuses everywhere
- ../../architecture/configuration.md — `getPublicOrigin` / instance naming used by the download page
