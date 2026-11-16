"use client"

import { useRef, type ComponentType } from "react"
import type { SayaMood, SayaShape, SayaTone } from "@sayabot/core/mascot"
import { LINKS } from "@/lib/links"
import { useInView, useSequence } from "@/lib/motion"
import { ArrowRight, CheckIcon, CloudIcon, LaptopIcon, ServerIcon } from "./icons"
import { Reveal } from "./reveal"
import { Saya } from "./saya"

type Row = {
  name: string
  text: string
  time: string
  shape: SayaShape
  tone: SayaTone
  unread?: boolean
}

type Home = {
  id: "mac" | "cloud" | "server"
  title: string
  body: string
  cta?: { label: string; href: string; external?: boolean }
  /** Listed on the card as part of the plan, not available yet. */
  soon?: string[]
  place: { name: string; detail: string; Icon: ComponentType<{ className?: string }> }
  /** Pill label by day and by night. */
  pill: [string, string]
  /** Mac agents nap when the Mac does. The others keep going. */
  sleeps: boolean
  rows: Row[]
  /** Arrives overnight, only where something is still awake to send it. */
  overnight?: Row
}

const HOMES: Home[] = [
  {
    id: "mac",
    title: "On your Mac",
    body: "Agents run through Claude Code, Codex and the other apps you're already signed in to, on your own subscription. Free on every plan.",
    cta: { label: "Download the app", href: "#download" },
    place: { name: "This Mac", detail: "Runs while it's awake", Icon: LaptopIcon },
    pill: ["Awake", "Asleep"],
    sleeps: true,
    rows: [
      {
        name: "Claude Code",
        text: "Flaky test fixed. PR is ready.",
        time: "11:48 PM",
        shape: "bubble",
        tone: "orange",
        unread: true,
      },
      {
        name: "Codex",
        text: "Refactor done, 6 files.",
        time: "11:20 PM",
        shape: "block",
        tone: "blue",
      },
      {
        name: "Researcher",
        text: "Found 12 sources for you.",
        time: "10:55 PM",
        shape: "hoot",
        tone: "teal",
      },
    ],
  },
  {
    id: "cloud",
    title: "On Sayabot Cloud",
    body: "We host it, nothing to set up. Every part below is in the plan, and none of it is on yet.",
    soon: [
      "Agents that keep going with the laptop shut",
      "Their own computers",
      "Routines and connectors around the clock",
      "Server replies on Free, Pro and Team",
      "Rooms shared with your team",
    ],
    place: { name: "Sayabot Cloud", detail: "Coming soon", Icon: CloudIcon },
    pill: ["Coming soon", "Coming soon"],
    sleeps: false,
    overnight: {
      name: "Price watcher",
      text: "No changes since Monday.",
      time: "3:00 AM",
      shape: "sprout",
      tone: "green",
      unread: true,
    },
    rows: [
      {
        name: "Morning brief",
        text: "Sent. 3 things need you.",
        time: "8:00 AM",
        shape: "peak",
        tone: "coral",
        unread: true,
      },
      {
        name: "Bookkeeper",
        text: "October is reconciled.",
        time: "7:30 AM",
        shape: "ledger",
        tone: "blue",
      },
      {
        name: "Social posts",
        text: "Friday's post is drafted.",
        time: "6:05 AM",
        shape: "bloom",
        tone: "pink",
      },
    ],
  },
  {
    id: "server",
    title: "On your own server",
    body: "Run the same open-source stack on a machine you control, free under the AGPL. Chats, agents and files never leave it.",
    cta: { label: "Read the self-host guide", href: LINKS.selfHost, external: true },
    place: { name: "Your server", detail: "On while it runs", Icon: ServerIcon },
    pill: ["Running", "Running"],
    sleeps: false,
    overnight: {
      name: "Uptime checker",
      text: "All 4 sites are up.",
      time: "3:00 AM",
      shape: "ghost",
      tone: "lilac",
    },
    rows: [
      {
        name: "Code reviewer",
        text: "3 comments on the login fix.",
        time: "9:12 AM",
        shape: "block",
        tone: "orange",
        unread: true,
      },
      {
        name: "Inbox",
        text: "Five new emails. Two urgent.",
        time: "8:40 AM",
        shape: "bubble",
        tone: "yellow",
      },
      {
        name: "Ops",
        text: "Backups verified overnight.",
        time: "8:15 AM",
        shape: "hoot",
        tone: "teal",
      },
    ],
  },
]

/** Day, then night: the Mac dozes off while the cloud and your server keep working. */
const BEATS = [4200, 5200] as const

function Notification({ row, mood }: { row: Row; mood: SayaMood }) {
  return (
    <>
      <Saya shape={row.shape} tone={row.tone} mood={mood} className="home-saya" />
      <span className="home-row-text">
        <strong>{row.name}</strong>
        <span>{row.text}</span>
      </span>
      <span className="home-row-meta">
        <time>{row.time}</time>
        {row.unread ? <i className="home-unread" /> : null}
      </span>
    </>
  )
}

export function Homes() {
  const ref = useRef<HTMLDivElement>(null)
  const visible = useInView(ref)
  const night = useSequence(BEATS, visible) === 1

  return (
    <section className="section homes" id="homes" aria-labelledby="homes-title">
      <div className="wrap">
        <Reveal className="homes-head">
          <span className="eyebrow">Where they run</span>
          <h2 className="h2" id="homes-title">
            Where your agents live.
          </h2>
          <p className="lede">
            The Mac app and a server you host work today. Sayabot Cloud is the same product, hosted
            by us, and it is coming soon.
          </p>
        </Reveal>

        <div className="homes-grid" ref={ref} data-night={night ? "true" : undefined}>
          {HOMES.map((home, index) => {
            const asleep = night && home.sleeps
            const { Icon } = home.place
            return (
              <Reveal as="article" index={index} key={home.id} className={`home home-${home.id}`}>
                <div className="home-scene" data-asleep={asleep ? "true" : undefined} aria-hidden>
                  <div className="home-sky home-sky-day" />
                  <div className="home-sky home-sky-night" />
                  <span className="home-sun" />
                  <span className="home-moon" />
                  <span className="home-puff home-puff-a" />
                  <span className="home-puff home-puff-b" />
                  <svg className="home-hills" viewBox="0 0 400 120" preserveAspectRatio="none">
                    <path d="M0 70C60 40 110 44 170 66S300 92 400 54V120H0Z" />
                    <path d="M0 96C80 72 150 78 220 92S340 104 400 86V120H0Z" />
                  </svg>

                  <div className="home-panel">
                    <ul className="home-rows">
                      {home.overnight ? (
                        <li
                          className="home-row home-row-new"
                          data-shown={night ? "true" : undefined}
                        >
                          <Notification row={home.overnight} mood="done" />
                        </li>
                      ) : null}
                      {home.rows.map((row) => (
                        <li className="home-row" key={row.name}>
                          <Notification row={row} mood={asleep ? "sleeping" : "idle"} />
                        </li>
                      ))}
                    </ul>
                    <div className="home-status">
                      <Icon className="home-status-icon" />
                      <span className="home-row-text">
                        <strong>{home.place.name}</strong>
                        <span>{home.place.detail}</span>
                      </span>
                      <span className="home-pill" data-off={asleep ? "true" : undefined}>
                        <i />
                        {night ? home.pill[1] : home.pill[0]}
                      </span>
                    </div>
                  </div>
                </div>

                <h3>{home.title}</h3>
                <p>{home.body}</p>
                {home.soon ? (
                  <ul className="home-soon">
                    {home.soon.map((line) => (
                      <li key={line}>
                        <CheckIcon />
                        <span>{line}</span>
                        <em>Coming soon</em>
                      </li>
                    ))}
                  </ul>
                ) : home.cta ? (
                  <a
                    className="home-link"
                    href={home.cta.href}
                    {...(home.cta.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  >
                    {home.cta.label} <ArrowRight />
                  </a>
                ) : null}
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
