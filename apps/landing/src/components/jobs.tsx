"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import type { SayaShape } from "@sayabot/core/mascot"
import { useInView } from "@/lib/motion"
import { Reveal } from "./reveal"
import { Saya } from "./saya"

type Job = {
  id: string
  label: string
  shape: SayaShape
  summary: string
  runs: string
  uses: string
  asks: string
  chat: { from: "bot" | "you"; text: string }[]
}

const JOBS: Job[] = [
  {
    id: "support",
    label: "Support triage",
    shape: "bubble",
    summary:
      "Reads every new question in your community channels, answers what the docs already cover, and turns real bugs into issues. Replies wait for you.",
    runs: "Every 30 minutes",
    uses: "Discord, Slack, Linear",
    asks: "Before posting any reply",
    chat: [
      {
        from: "bot",
        text: "12 new questions overnight. 9 are answered in the docs, so I drafted replies.",
      },
      {
        from: "bot",
        text: "3 look like real bugs. I opened Linear issues with steps to reproduce.",
      },
      { from: "you", text: "Post the drafts" },
      {
        from: "bot",
        text: "Posted all 9. I'll keep an eye on the threads and ping you if anyone pushes back.",
      },
    ],
  },
  {
    id: "books",
    label: "Bookkeeper",
    shape: "ledger",
    summary:
      "Matches receipts, chases overdue invoices and keeps the books tidy. It drafts every reminder; nothing goes out without a yes.",
    runs: "Weekdays at 7:00",
    uses: "Stripe, Google Drive",
    asks: "Before sending anything",
    chat: [
      {
        from: "bot",
        text: "4 invoices are overdue, the largest $1,280 from Northwind, 12 days late.",
      },
      {
        from: "bot",
        text: "Friendly reminders are drafted. Receipts for March are filed in Drive.",
      },
      { from: "you", text: "Send the reminders" },
      { from: "bot", text: "Sent all 4. Northwind already replied: paying on Friday." },
    ],
  },
  {
    id: "engineer",
    label: "Engineer",
    shape: "block",
    summary:
      "Watches errors and issues, reproduces them on its own computer, and comes back with a fix and a test. You approve the pull request.",
    runs: "When an issue is labelled",
    uses: "GitHub, Sentry",
    asks: "Before opening PRs or running deploys",
    chat: [
      {
        from: "bot",
        text: "Sentry flagged a checkout crash after last night's deploy. I reproduced it.",
      },
      {
        from: "bot",
        text: "Root cause is rounding in cart.ts. The fix and a regression test are ready.",
      },
      { from: "you", text: "Open the PR" },
      { from: "bot", text: "PR #212 is open and CI is green. I'll handle review comments." },
    ],
  },
  {
    id: "research",
    label: "Research",
    shape: "hoot",
    summary:
      "Reads the sources you care about, keeps a running brief in your docs, and tells you what changed since last week.",
    runs: "Mondays at 8:00",
    uses: "Notion, the web",
    asks: "Before sharing outside the workspace",
    chat: [
      {
        from: "bot",
        text: "This week's competitor brief is in Notion. 12 sources, 3 real changes.",
      },
      { from: "bot", text: "Biggest one: Northstar cut its entry plan to $59 two days ago." },
      { from: "you", text: "Add a pricing table" },
      { from: "bot", text: "Added. Four plans side by side, with what each one leaves out." },
    ],
  },
  {
    id: "chief",
    label: "Chief of Staff",
    shape: "peak",
    summary:
      "Starts your day with what matters: meetings, decisions waiting on you and documents to read, already summarised.",
    runs: "Weekdays at 7:30",
    uses: "Slack, Google Drive, Notion",
    asks: "Before replying on your behalf",
    chat: [
      {
        from: "bot",
        text: "Morning. 3 meetings, 2 decisions waiting on you, 1 contract in Drive to sign.",
      },
      { from: "bot", text: "The vendor thread in Slack needs an answer by noon." },
      { from: "you", text: "Summarise the contract" },
      {
        from: "bot",
        text: "12-month term, 30-day exit, price fixed for the year. Nothing unusual.",
      },
    ],
  },
  {
    id: "growth",
    label: "Growth & SEO",
    shape: "sprout",
    summary:
      "Audits your site every week, finds the pages that slipped, and fixes the easy ones in a pull request.",
    runs: "Mondays at 6:00",
    uses: "GitHub, the web",
    asks: "Before opening PRs",
    chat: [
      {
        from: "bot",
        text: "Audited 40 pages. 6 are missing meta descriptions, 2 have broken links.",
      },
      { from: "bot", text: "I wrote the descriptions and fixed the links on a branch." },
      { from: "you", text: "Ship it" },
      { from: "bot", text: "PR #88 is open with all 8 fixes. Preview link is in the description." },
    ],
  },
]

export function Jobs() {
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const visible = useInView(ref)
  const job = JOBS[active] ?? JOBS[0]

  useEffect(() => {
    if (!auto || !visible || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = window.setTimeout(() => setActive((value) => (value + 1) % JOBS.length), 9000)
    return () => window.clearTimeout(timer)
  }, [active, auto, visible])

  if (!job) return null
  return (
    <section className="section" id="agents" aria-labelledby="jobs-title">
      <div className="wrap jobs" ref={ref}>
        <div className="jobs-copy">
          <Reveal>
            <span className="eyebrow">Agents</span>
            <h2 className="h2" id="jobs-title">
              Give each agent a job worth doing.
            </h2>
            <p className="lede">
              Pick one to see what it reports back, and what it waits for you to approve.
            </p>
          </Reveal>

          <Reveal index={1}>
            <div className="jobs-tabs" role="tablist" aria-label="Agent jobs">
              {JOBS.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={index === active}
                  aria-controls="job-panel"
                  className={`jobs-tab ${index === active ? "is-active" : ""}`}
                  onClick={() => {
                    setActive(index)
                    setAuto(false)
                  }}
                >
                  <Saya
                    shape={item.shape}
                    mood={index === active ? "done" : "idle"}
                    className="jobs-tab-face"
                  />
                  {item.label}
                  {index === active && auto ? (
                    <span className="jobs-progress" key={active} />
                  ) : null}
                </button>
              ))}
            </div>
          </Reveal>

          <div className="jobs-detail" id="job-panel" role="tabpanel" key={job.id}>
            <p className="jobs-summary">{job.summary}</p>
            <dl className="jobs-meta">
              <div>
                <dt>Runs</dt>
                <dd>{job.runs}</dd>
              </div>
              <div>
                <dt>Uses</dt>
                <dd>{job.uses}</dd>
              </div>
              <div>
                <dt>Asks you</dt>
                <dd>{job.asks}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="phone-wrap">
          <div className="phone" aria-label={`Example chat with the ${job.label} agent`}>
            <div className="phone-notch" />
            <div className="phone-head" key={`head-${job.id}`}>
              <Saya shape={job.shape} mood="done" live follow className="phone-face" />
              <span className="phone-name">{job.label}</span>
            </div>
            <div className="phone-thread" key={job.id}>
              <span className="phone-time">Today {job.runs.match(/\d+:\d+/)?.[0] ?? "9:00"}</span>
              {job.chat.map((line, index) => (
                <div
                  key={index}
                  className={`phone-msg ${line.from === "you" ? "is-you" : ""}`}
                  style={{ "--d": `${0.3 + index * 0.9}s` } as CSSProperties}
                >
                  {line.text}
                </div>
              ))}
            </div>
            <div className="phone-input">Ask {job.label}</div>
          </div>
          <p className="phone-note">Illustrative chat with made-up data.</p>
        </div>
      </div>
    </section>
  )
}
