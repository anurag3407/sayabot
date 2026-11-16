import { AgentWindow } from "@/components/agent-window"
import { Computer } from "@/components/computer"
import { Downloads } from "@/components/downloads"
import { Features } from "@/components/features"
import { FinalCta } from "@/components/final-cta"
import { Flow } from "@/components/flow"
import { Footer } from "@/components/footer"
import { Hero } from "@/components/hero"
import { How } from "@/components/how"
import { Jobs } from "@/components/jobs"
import { Nav } from "@/components/nav"
import { Tools } from "@/components/tools"

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <section className="demo" aria-label="An agent at work">
          <div className="wrap">
            <AgentWindow />
          </div>
        </section>
        <Tools />
        <Jobs />
        <How />
        <Computer />
        <Flow />
        <Features />
        <Downloads />
        <FinalCta />
      </main>
      <Footer />
    </>
  )
}
