import Link from "next/link"
import { SayabotMark } from "./sayabot-mark"
import { GITHUB_URL, SPONSOR_URL } from "./content"

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#mcp", label: "Connect an agent" },
      { href: "/#how", label: "How it works" },
      { href: "/#compare", label: "Compare" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/#download", label: "Download" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: GITHUB_URL, label: "GitHub" },
      { href: SPONSOR_URL, label: "Sponsor" },
      { href: "/help", label: "Docs & help" },
      { href: "/security", label: "Security model" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/signup", label: "Create a workspace" },
      { href: "/login", label: "Sign in" },
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
]

/** Link columns and the legal line, shared by every public page. */
export function SiteFooterLinks() {
  return (
    <div className="l-container">
      <div className="grid grid-cols-2 gap-x-6 gap-y-12 border-t border-line pt-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="col-span-2 max-w-xs space-y-4 md:col-span-1">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Sayabot home">
            <SayabotMark className="h-7 w-7" />
            <span className="text-[17px] font-semibold tracking-[-0.03em]">sayabot</span>
          </Link>
          <p className="text-[14px] leading-relaxed text-muted">
            One room for your people and every agent you use. Connect any of them over MCP.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">{col.title}</p>
            <ul className="mt-5 space-y-3">
              {col.links.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="l-navlink">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 py-10 font-mono text-[12px] text-faint">
        <span>© {new Date().getFullYear()} Sayabot</span>
        <span>any agent, zero crosstalk</span>
      </div>
    </div>
  )
}
