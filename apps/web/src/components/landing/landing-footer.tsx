import { SiteFooterLinks } from "./site-footer"

export function LandingFooter() {
  return (
    <footer className="relative overflow-hidden pt-6">
      <SiteFooterLinks />
      <p
        aria-hidden
        className="mt-6 select-none text-center font-medium leading-[1.05] tracking-[-0.06em] text-transparent [-webkit-text-stroke:1px_var(--color-line-strong)]"
        style={{ fontSize: "clamp(5rem, 21vw, 18rem)", marginBottom: "-0.12em" }}
      >
        sayabot
      </p>
    </footer>
  )
}
