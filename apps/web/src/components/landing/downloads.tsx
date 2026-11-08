import type { ComponentType } from "react"
import { ArrowDownToLine } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"
import { AndroidIcon, AppleIcon, LinuxIcon, WindowsIcon } from "./brand-icons"
import { DOWNLOADS } from "./content"

const READY = [
  { name: "macOS", meta: "Apple silicon · macOS 13+", href: DOWNLOADS.mac, cta: "Download for Mac", icon: AppleIcon, bg: "#cdaeee", seed: "Mac buddy", shape: "dome" as const, color: "var(--color-m-pink)" },
  { name: "Android", meta: "Connects to your workspace", href: DOWNLOADS.android, cta: "Download for Android", icon: AndroidIcon, bg: "#e7a184", seed: "Android buddy", shape: "pentagon" as const, color: "var(--color-m-yellow)" },
]

const SOON: { name: string; icon: ComponentType<{ className?: string }> }[] = [
  { name: "Windows", icon: WindowsIcon },
  { name: "Linux", icon: LinuxIcon },
  { name: "iPhone", icon: AppleIcon },
]

export function Downloads() {
  return (
    <section id="download" className="l-section">
      <div className="l-container">
        <div className="text-center">
          <span className="l-eyebrow" data-reveal>Download</span>
          <h2 className="l-h2 mx-auto mt-4" data-split>Take your team with you.</h2>
        </div>

        <div className="mt-20 grid gap-16 sm:grid-cols-2 sm:gap-4">
          {READY.map((item) => (
            <a
              key={item.name}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              data-reveal
              className="group relative block"
            >
              <span data-tilt className="relative block rounded-[22px] p-7 text-[#15121a] sm:p-8" style={{ background: item.bg }}>
                <Mascot
                  seed={item.seed}
                  shape={item.shape}
                  color={item.color}
                  fuzzy
                  blink
                  className="absolute -top-12 right-8 h-24 w-24 transition-transform duration-500 ease-out group-hover:-translate-y-3 group-hover:rotate-6"
                />
                <item.icon className="h-11 w-11" />
                <span className="mt-16 block text-[clamp(2.25rem,4.4vw,3.25rem)] font-medium leading-none tracking-[-0.04em]">
                  {item.name}
                </span>
                <span className="mt-2.5 block text-[14px] opacity-70">{item.meta}</span>
                <span className="mt-6 inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#15121a] px-4 text-[14px] font-medium text-white">
                  <ArrowDownToLine className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                  {item.cta}
                </span>
              </span>
            </a>
          ))}
        </div>

        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {SOON.map((item) => (
            <li key={item.name} data-reveal className="l-card flex items-center gap-3 px-5 py-4">
              <item.icon className="h-5 w-5 text-faint" />
              <span className="text-[14px] text-muted">{item.name}</span>
              <span className="ml-auto font-mono text-[10px] tracking-[0.12em] text-faint">COMING SOON</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
