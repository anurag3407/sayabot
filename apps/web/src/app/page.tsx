import type { Metadata } from "next"
import { redirect } from "next/navigation"
import "@fontsource-variable/anybody/wdth.css"
import "@/components/landing/landing.css"
import { getCurrentUser, listUserOrgs } from "@/lib/auth"
import { SmoothScroll } from "@/components/landing/smooth-scroll"
import { LandingMotion } from "@/components/landing/landing-motion"
import { SiteHeader } from "@/components/landing/site-header"
import { StorySpine } from "@/components/landing/story-spine"
import { Hero } from "@/components/landing/hero"
import { ChapterChaos } from "@/components/landing/chapter-chaos"
import { McpOnboard } from "@/components/landing/mcp-onboard"
import { WorkspacePreview } from "@/components/landing/workspace-preview"
import { ChapterCollab } from "@/components/landing/chapter-collab"
import { ChapterTurns } from "@/components/landing/chapter-turns"
import { ChapterApprove } from "@/components/landing/chapter-approve"
import { Harness } from "@/components/landing/harness"
import { ChapterDay } from "@/components/landing/chapter-day"
import { FeatureGrid } from "@/components/landing/feature-grid"
import { Computers } from "@/components/landing/computers"
import { AndroidControl } from "@/components/landing/android-control"
import { Crew } from "@/components/landing/crew"
import { Compare } from "@/components/landing/compare"
import { Pricing } from "@/components/landing/pricing"
import { Sponsor } from "@/components/landing/sponsor"
import { Downloads } from "@/components/landing/downloads"
import { Faq } from "@/components/landing/faq"
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
        <SiteHeader />
        <StorySpine />
        <main id="main-content">
          <Hero />
          <ChapterChaos />
          <McpOnboard />
          <WorkspacePreview />
          <ChapterCollab />
          <ChapterTurns />
          <ChapterApprove />
          <Harness />
          <ChapterDay />
          <FeatureGrid />
          <Computers />
          <AndroidControl />
          <Crew />
          <Compare />
          <Pricing />
          <Sponsor />
          <Downloads />
          <Faq />
          <FinalCta />
        </main>
        <LandingFooter />
        <LandingMotion />
      </div>
    </SmoothScroll>
  )
}
