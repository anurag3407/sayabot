import type { Metadata } from "next"
import { redirect } from "next/navigation"
import "@/components/landing/landing.css"
import { getCurrentUser, listUserOrgs } from "@/lib/auth"
import { githubAuthEnabled, googleAuthEnabled } from "@/lib/env"
import { SmoothScroll } from "@/components/landing/smooth-scroll"
import { SiteHeader } from "@/components/landing/site-header"
import { Hero } from "@/components/landing/hero"
import { Marquee } from "@/components/landing/marquee"
import { Crew } from "@/components/landing/crew"
import { Manifesto } from "@/components/landing/manifesto"
import { HowItWorks } from "@/components/landing/how-it-works"
import { Platform } from "@/components/landing/platform"
import { Trust } from "@/components/landing/trust"
import { FinalCta } from "@/components/landing/final-cta"
import { LandingFooter } from "@/components/landing/landing-footer"

export const metadata: Metadata = {
  title: { absolute: "Sayabot · Shared rooms for people and AI agents" },
  description:
    "Human teams and AI agents share rooms, take turns, edit one live canvas and stop for human approval before anything risky runs.",
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
      <div className="relative bg-void text-text">
        <SiteHeader />
        <main id="main-content">
          <Hero />
          <Marquee />
          <Crew />
          <Manifesto />
          <HowItWorks />
          <Platform />
          <Trust />
          <FinalCta googleEnabled={googleAuthEnabled()} githubEnabled={githubAuthEnabled()} />
        </main>
        <LandingFooter />
      </div>
    </SmoothScroll>
  )
}
