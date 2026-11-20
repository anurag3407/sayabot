import { ArrowUpRight, HeartIcon, ServerIcon, SparkIcon } from "./icons"
import { Reveal } from "./reveal"
import { LINKS } from "@/lib/links"
import {
  ClaudeLogo,
  OpenAiLogo,
  GeminiLogo,
  HermesLogo,
  CursorLogo,
  CloudflareLogo,
  McpLogo,
  GitHubLogo,
  SlackLogo,
  LinearLogo,
} from "./brand-logos"

/**
 * Partners & Sponsors data list.
 * You can add, remove, or edit your sponsors here whenever new partners join.
 */
export interface PartnerItem {
  id: string
  name: string
  badge: string
  badgeColor?: string
  description: string
  href: string
  linkText: string
  featured?: boolean
  iconType: "cloud" | "inference" | "sponsor"
}

export const PARTNER_ITEMS: PartnerItem[] = [
  {
    id: "boat-dev",
    name: "boat.dev",
    badge: "FEATURED PARTNER · CLOUD COMPUTERS",
    badgeColor: "#9d8cff",
    description:
      "Every bot can get its own Linux computer in the cloud, with a desktop you can watch live while it works and take over at any time.",
    href: "https://boat.dev",
    linkText: "Visit boat.dev",
    featured: true,
    iconType: "cloud",
  },
  {
    id: "modelgo",
    name: "ModelGo",
    badge: "INFERENCE PROVIDER SPONSOR",
    badgeColor: "#22c55e",
    description:
      "One API key, every model: text, image, video, audio and more through a single unified API, ready to pick in Sayabot's multi-agent model picker.",
    href: "https://modelgo.ai",
    linkText: "Visit ModelGo",
    iconType: "inference",
  },
  {
    id: "github-sponsors",
    name: "Community Backers",
    badge: "OPEN SOURCE BACKERS · GITHUB SPONSORS",
    badgeColor: "#ec4899",
    description:
      "Sayabot is 100% open source. Community sponsorships directly fund container testing nodes, GPU inference runners, and core protocol research.",
    href: LINKS.sponsor,
    linkText: "Sponsor on GitHub",
    iconType: "sponsor",
  },
]

export function Partners() {
  return (
    <section className="section partners" id="partners" aria-labelledby="partners-title">
      <div className="wrap">
        {/* Header with Title on Left, Action Buttons on Right */}
        <Reveal className="partners-header">
          <div className="partners-head-text">
            <span className="eyebrow">Ecosystem &amp; Backers</span>
            <h2 className="h2" id="partners-title">
              Our partners &amp; sponsors
            </h2>
            <p className="lede partners-lede">
              Every bot borrows a brain, a pair of hands, and a set of keys. These are the companies
              and supporters behind the project. Want your product here?{" "}
              <a
                href="mailto:sayalabs.studio@gmail.com?subject=Sayabot%20Partnership%20Inquiry"
                className="partners-inline-link"
              >
                Become a partner
              </a>
              .
            </p>
          </div>

          <div className="partners-actions">
            <a
              href={LINKS.sponsor}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sponsor"
              id="sponsor-btn"
            >
              <HeartIcon className="sponsor-heart" />
              <span>Sponsor me</span>
            </a>
            <a
              href="mailto:sayalabs.studio@gmail.com?subject=Sayabot%20Partnership%20Inquiry"
              className="btn btn-ghost btn-partner"
            >
              <span>Become a partner</span>
            </a>
          </div>
        </Reveal>

        {/* Sponsor Cards Grid */}
        <div className="partners-cards">
          {PARTNER_ITEMS.map((item, index) => (
            <Reveal
              key={item.id}
              className={`partner-card card ${item.featured ? "is-featured" : ""}`}
              index={index}
            >
              <div className="partner-card-main">
                <div className="partner-brand">
                  <div className={`partner-logo-box partner-logo-${item.iconType}`}>
                    {item.iconType === "cloud" && (
                      <svg
                        className="partner-svg-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                        <path d="M12 12v9" />
                        <path d="m8 17 4 4 4-4" />
                      </svg>
                    )}
                    {item.iconType === "inference" && (
                      <svg
                        className="partner-svg-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                      </svg>
                    )}
                    {item.iconType === "sponsor" && (
                      <HeartIcon className="partner-svg-icon partner-heart-icon" />
                    )}
                  </div>
                  <div className="partner-title-wrap">
                    <h3 className="partner-name">{item.name}</h3>
                    <span
                      className="partner-badge"
                      style={{ color: item.badgeColor || "var(--accent)" }}
                    >
                      {item.badge}
                    </span>
                  </div>
                </div>

                <div className="partner-body">
                  <p className="partner-desc">{item.description}</p>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="partner-link"
                  >
                    <span>{item.linkText}</span>
                    <ArrowUpRight className="partner-link-arrow" />
                  </a>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Tag Rows: MODELS & TOOLS AND APPS (exact match to reference) */}
        <div className="partners-tags-wrap">
          {/* Models Row */}
          <div className="partners-tag-row">
            <span className="partners-tag-label">MODELS</span>
            <div className="partners-pills">
              <span className="partner-pill">
                <ClaudeLogo size={14} />
                <span>Claude · Anthropic</span>
              </span>
              <span className="partner-pill">
                <OpenAiLogo size={14} />
                <span>Codex &amp; GPT · OpenAI</span>
              </span>
              <span className="partner-pill">
                <GeminiLogo size={14} />
                <span>Gemini · Google</span>
              </span>
              <span className="partner-pill">
                <HermesLogo size={14} />
                <span>Hermes · Nous Research</span>
              </span>
              <span className="partner-pill">
                <span className="pill-dot" style={{ background: "#3b82f6" }} />
                <span>DeepSeek</span>
              </span>
              <span className="partner-pill">
                <span className="pill-dot" style={{ background: "#ec4899" }} />
                <span>Grok · xAI</span>
              </span>
              <span className="partner-pill">
                <CursorLogo size={14} />
                <span>Cursor</span>
              </span>
              <span className="partner-pill">
                <span className="pill-dot" style={{ background: "#eab308" }} />
                <span>Ollama · Open source</span>
              </span>
            </div>
          </div>

          {/* Tools & Infrastructure Row */}
          <div className="partners-tag-row">
            <span className="partners-tag-label">TOOLS AND APPS</span>
            <div className="partners-pills">
              <span className="partner-pill">
                <ServerIcon className="pill-svg" />
                <span>computerd Linux Sandboxes</span>
              </span>
              <span className="partner-pill">
                <McpLogo size={14} />
                <span>Model Context Protocol (MCP)</span>
              </span>
              <span className="partner-pill">
                <CloudflareLogo size={14} />
                <span>Cloudflare Edge &amp; Tunnels</span>
              </span>
              <span className="partner-pill">
                <GitHubLogo size={14} />
                <span>GitHub Connectors</span>
              </span>
              <span className="partner-pill">
                <SlackLogo size={14} />
                <span>Slack Bot Sync</span>
              </span>
              <span className="partner-pill">
                <LinearLogo size={14} />
                <span>Linear Issues</span>
              </span>
              <span className="partner-pill">
                <SparkIcon className="pill-svg" />
                <span>Composio Connected Apps</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
