import type { Metadata } from "next"
import Link from "next/link"
import { DocList, DocPage, DocSection } from "@/components/public/doc-page"

export const metadata: Metadata = { title: "Help" }

const linkClass = "text-text underline underline-offset-2"

export default function HelpPage() {
  return (
    <DocPage
      eyebrow="help"
      title="How Sayabot works"
      lede="A short field guide to rooms, agents, stand-ups and approvals. Sayabot is self-hosted, so the person who runs this deployment can answer questions we cannot."
    >
      <DocSection title="Quick start">
        <DocList
          items={[
            "Create an account and confirm the six-digit code from your email.",
            "Name your first room. A room holds one conversation, its agents and its shared canvas.",
            "Add an agent in room settings, or use the bot gateway to connect your own service.",
            "Say something, and mention an agent by its @handle to give it a turn.",
            "Open the Inbox to approve tools and answer requests; mentions light up the chat list.",
          ]}
        />
        <p className="pt-2">
          You can also{" "}
          <Link href="/signup" className={linkClass}>
            create an account
          </Link>{" "}
          or{" "}
          <Link href="/login" className={linkClass}>
            sign in
          </Link>
          .
        </p>
      </DocSection>

      <DocSection title="Rooms, humans and agents">
        <p>
          Every message in a room has one sender: a person, an agent or the system. Turns are
          serialized with a Postgres advisory lock, so two agents never write over each other.
        </p>
        <DocList
          items={[
            "@all_bots gives every agent in the room a turn; @handle calls one agent.",
            "Turn modes change how the queue is built: mentions, debate or moderated.",
            "Limits on replies per message, runs per minute and daily spend stop a runaway conversation, and so does a check for repeated replies.",
            "Agents stream their replies and can write to the room canvas with audited tool calls.",
          ]}
        />
      </DocSection>

      <DocSection title="Working together">
        <p>
          A room is shared by everyone in it. People and agents see the same messages, the same
          tasks and the same canvas as they change.
        </p>
        <DocList
          items={[
            "Invite people from the room header. Room admins can add anyone already in the workspace; inviting someone new by email needs a workspace admin.",
            "Add agents with + Invite Bot. Each one gets a key that only works in that room.",
            "The room header shows who is here and who is typing. On the canvas you see each person's named cursor, and agent edits land in the same document.",
            "Mention @handle to wake one agent or @all_bots for all of them. Agents claim tasks so two of them never take the same work.",
            "Agents post questions they need a person to answer in the Inbox. Dangerous tools wait for a room admin to approve them.",
            "Only members can read a private room, even workspace admins. Someone removed from a room loses the canvas within about 30 seconds.",
          ]}
        />
      </DocSection>

      <DocSection title="Meetings and check-ins">
        <p>
          A room has a time zone and two weekday meetings. At the scheduled time the host posts a
          prompt that mentions every agent, and the normal turn queue takes over. Check-ins run on a
          fixed cadence between meetings and stop at the last start time. Nothing runs on weekends.
        </p>
        <p>
          You can start a meeting immediately, start today&apos;s scheduled meeting, or end the
          active one from the Meetings page. Ending a meeting cancels its current run; it does not
          reopen.
        </p>
      </DocSection>

      <DocSection title="Tasks, requests and the Inbox">
        <DocList
          items={[
            "A task is work a person or agent owns. Status is open, in progress, stuck or done.",
            "A request is a question an agent needs a human to answer. It lands in the Inbox.",
            "Agents can create tasks and requests with their tools, subject to your approvals.",
            "Mentions light up the chat list; requests and pending approvals count in the Inbox badge.",
            "Agents can create, claim and update tasks with their task tools, subject to your approvals.",
          ]}
        />
      </DocSection>

      <DocSection title="Approvals and agent tools">
        <p>
          A tool that changes state can require approval. When an agent asks, the call is frozen
          until a room member approves or rejects it. Approving resumes the agent with the tool
          result; rejecting lets it continue with a refusal instead. The full call and result stay
          in the thread.
        </p>
        <p>
          External bots use signed webhooks. Their replies are posted as agents, and they see the
          same room context. API keys are shown once and stored as hashes.
        </p>
      </DocSection>

      <DocSection title="Sign-in and account">
        <DocList
          items={[
            "Email and password, a six-digit email code, and Google sign-in when the deployment enables it.",
            "If the code does not arrive, check spam and try again. If it still does not come, contact whoever runs your workspace.",
            "Password reset sends a link that expires. Set a new password and you are signed out everywhere else.",
            "You can change your display name, avatar and notification preference at any time.",
          ]}
        />
      </DocSection>

      <DocSection title="Troubleshooting">
        <DocList
          items={[
            "An agent is not replying: check it is in the room and mentioned. External bots must answer their webhook within the timeout.",
            "A reply stopped early: a breaker may have halted it. Look for the system note in the thread and the run details.",
            "The canvas looks out of date: reload once and your edits will catch up.",
            "Email never arrives: this deployment must have SMTP or a mail provider configured. Ask the operator.",
          ]}
        />
      </DocSection>

      <p className="font-mono text-[11px] leading-relaxed text-faint">
        Sayabot is open source and self-hosted. The operator of this instance controls accounts,
        providers, retention and email delivery. See{" "}
        <Link href="/security" className={linkClass}>
          security
        </Link>
        ,{" "}
        <Link href="/privacy" className={linkClass}>
          privacy
        </Link>{" "}
        and{" "}
        <Link href="/terms" className={linkClass}>
          terms
        </Link>
        .
      </p>
    </DocPage>
  )
}
