import type { Metadata } from "next"
import { redirect } from "next/navigation"
import "@/components/landing/landing.css"
import { getCurrentUser, listUserOrgs } from "@/lib/auth"
import { SmoothScroll } from "@/components/landing/smooth-scroll"
import { LandingMotion } from "@/components/landing/landing-motion"
import { SiteHeader } from "@/components/landing/site-header"
import { Hero } from "@/components/landing/hero"
import { WorkspacePreview } from "@/components/landing/workspace-preview"
import { FeatureGrid } from "@/components/landing/feature-grid"
import { McpOnboard } from "@/components/landing/mcp-onboard"
import { HowItWorks } from "@/components/landing/how-it-works"
import { MeetingRoom } from "@/components/landing/meeting-room"
import { Harness } from "@/components/landing/harness"
import { Computers } from "@/components/landing/computers"
import { AndroidControl } from "@/components/landing/android-control"
import { Pricing } from "@/components/landing/pricing"
import { Sponsor } from "@/components/landing/sponsor"
import { Testimonials } from "@/components/landing/testimonials"
import { Faq } from "@/components/landing/faq"
import { Compare } from "@/components/landing/compare"
import { Downloads } from "@/components/landing/downloads"
import { FinalCta } from "@/components/landing/final-cta"
import { LandingFooter } from "@/components/landing/landing-footer"

export const metadata: Metadata = {
  title: { absolute: "Sayabot · Every agent you use, working in one room" },
  description:
    "Connect any agent over MCP. Sayabot gives them shared rooms with your team, real turn-taking, their own computers and human approval before anything risky.",
}
export const dynamic = "force-dynamic"

export default async function HomePage() {
  const user = await getCurrentUser()
  if (user) {
    const orgs = await listUserOrgs(user.id)
    redirect(orgs.length ? `/${orgs[0]!.slug}` : "/onboarding")
  }

  return (
    <SmoothScroll>
      <div className="l-page text-text">
        <div className="l-progress" aria-hidden />
        <div className="l-gutters" aria-hidden />
        <SiteHeader />
        <main id="main-content">
          <Hero />
          <WorkspacePreview />
          <div className="l-rule" />
          <FeatureGrid />
          <div className="l-rule" />
          <McpOnboard />
          <div className="l-rule" />
          <HowItWorks />
          <div className="l-rule" />
          <MeetingRoom />
          <div className="l-rule" />
          <Harness />
          <div className="l-rule" />
          <Computers />
          <div className="l-rule" />
          <AndroidControl />
          <div className="l-rule" />
          <Pricing />
          <Sponsor />
          <Testimonials />
          <div className="l-rule" />
          <Faq />
          <div className="l-rule" />
          <Compare />
          <div className="l-rule" />
          <Downloads />
          <div className="l-rule" />
          <FinalCta />
        </main>
        <LandingFooter />
        <LandingMotion />
      </div>
    </SmoothScroll>
  )
}
