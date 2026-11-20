import { AgentWindow } from "@/components/agent-window"
import { Board } from "@/components/board"
import { Computer } from "@/components/computer"
import { Day } from "@/components/day"
import { Decisions } from "@/components/decisions"
import { Downloads } from "@/components/downloads"
import { Faq } from "@/components/faq"
import { Features } from "@/components/features"
import { FinalCta } from "@/components/final-cta"
import { Flow } from "@/components/flow"
import { Footer } from "@/components/footer"
import { Hero } from "@/components/hero"
import { Homes } from "@/components/homes"
import { How } from "@/components/how"
import { Jobs } from "@/components/jobs"
import { Memory } from "@/components/memory"
import { Nav } from "@/components/nav"
import { Partners } from "@/components/partners"
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
        <Memory />
        <Decisions />
        <Board />
        <Day />
        <Homes />
        <Faq />
        <Downloads />
        <Partners />
        <FinalCta />
      </main>
      <Footer />
    </>
  )
}
