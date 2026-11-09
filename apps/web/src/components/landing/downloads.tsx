import type { ComponentType } from "react"
import { ArrowDownToLine } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"
import { SectionHead } from "./section-head"
import { AndroidIcon, AppleIcon, LinuxIcon, WindowsIcon } from "./brand-icons"
import { DOWNLOADS } from "./content"

const READY = [
  { name: "Web & Desktop", meta: "PWA installable on Mac, Windows & Linux", href: DOWNLOADS.web, cta: "Launch in Browser", icon: AppleIcon, bg: "linear-gradient(165deg,#ecdfff,#c6a3ee)", seed: "Pip" },
  { name: "Mobile App", meta: "Installable PWA & Expo React Native app", href: DOWNLOADS.mobile, cta: "Open Mobile App", icon: AndroidIcon, bg: "linear-gradient(165deg,#ffe1cf,#ef9f7f)", seed: "Juno" },
]

const SOON: { name: string; icon: ComponentType<{ className?: string }> }[] = [
  { name: "Native macOS .dmg", icon: AppleIcon },
  { name: "Native Windows .exe", icon: WindowsIcon },
  { name: "Google Play Store", icon: AndroidIcon },
]

export function Downloads() {
  return (
    <section id="download" className="l-section">
      <div className="l-container">
        <SectionHead center label="Download" title="Take your team with you." />

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
              <span data-tilt className="relative block rounded-[26px] p-7 text-[#15121a] shadow-[inset_0_1px_0_rgb(255_255_255/0.5),0_40px_70px_-34px_rgb(0_0_0/0.95)] sm:p-9" style={{ background: item.bg }}>
                <Mascot
                  seed={item.seed}
                  blink
                  shadow
                  className="absolute -top-12 right-8 h-24 w-24 transition-transform duration-500 ease-out group-hover:-translate-y-3 group-hover:rotate-6"
                />
                <item.icon className="h-11 w-11" />
                <span className="mt-16 block text-[clamp(2.25rem,4.4vw,3.25rem)] font-medium leading-none tracking-[-0.04em]">
                  {item.name}
                </span>
                <span className="mt-2.5 block text-[14px] opacity-70">{item.meta}</span>
                <span className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-[#15121a] px-4 text-[14px] font-medium text-white">
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
