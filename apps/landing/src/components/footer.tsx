import { LINKS } from "@/lib/links"
import { Saya } from "./saya"

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Download", href: "#download" },
      { label: "Web app", href: LINKS.app },
      { label: "How it works", href: "#how" },
      { label: "Computers", href: "#computer" },
      { label: "Memory", href: "#memory" },
      { label: "Questions", href: "#faq" },
    ],
  },
  {
    title: "Open source",
    links: [
      { label: "GitHub", href: LINKS.github },
      { label: "Releases", href: LINKS.releases },
      { label: "Self-hosting", href: LINKS.selfHost },
      { label: "Docs", href: LINKS.docs },
      { label: "Sponsor", href: LINKS.sponsor },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: LINKS.privacy },
      { label: "Terms", href: LINKS.terms },
      { label: "Security", href: LINKS.security },
      { label: "Licensing", href: LINKS.license },
    ],
  },
]

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-top">
        <div className="footer-brand">
          <a href="#top" className="nav-brand" aria-label="Back to top">
            <Saya shape="ghost" follow className="nav-mark" />
            <span>Sayabot</span>
          </a>
          <p>Remote agents with their own computers. Open source, AGPL-3.0.</p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} className="footer-col" aria-label={column.title}>
            <h4>{column.title}</h4>
            {column.links.map((link) => {
              const external = link.href.startsWith("http")
              return (
                <a
                  key={link.label}
                  href={link.href}
                  {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                >
                  {link.label}
                </a>
              )
            })}
          </nav>
        ))}
      </div>
      <div className="footer-word" aria-hidden>
        <span>sayabot</span>
        <Saya shape="hoot" follow className="footer-peek" />
      </div>
      <div className="wrap footer-bottom">
        <span>© {new Date().getFullYear()} Sayabot</span>
        <a href={LINKS.issues} target="_blank" rel="noreferrer">
          Report an issue
        </a>
      </div>
    </footer>
  )
}
