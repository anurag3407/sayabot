"use client"

import Link from "next/link"
import { useActionState, useEffect, useState } from "react"
import {
  resendVerificationAction,
  sendMagicLinkAction,
  signInEmailAction,
  signUpAction,
  verifyEmailAction,
} from "@/lib/actions/auth"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { InlineAlert } from "@/components/ui/empty"
import { CodeInput } from "@/components/auth/code-input"
import { OAuthButtons } from "@/components/auth/oauth-buttons"
import { cn } from "@/lib/format"
import type { ActionResult } from "@/lib/types"

type Mode = "signup" | "signin"
type Verification = { email: string; next: string }

function needsVerification(state: ActionResult | null): { email: string } | null {
  if (state?.data?.needsVerification === true && typeof state.data.email === "string") {
    return { email: state.data.email }
  }
  return null
}

function SignUpForm({
  next,
  googleEnabled,
  githubEnabled,
  onVerify,
  onSwitch,
}: {
  next: string
  googleEnabled: boolean
  githubEnabled: boolean
  onVerify: (email: string) => void
  onSwitch: () => void
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(signUpAction, null)
  useEffect(() => {
    const verification = needsVerification(state)
    if (verification) onVerify(verification.email)
  }, [state, onVerify])
  return (
    <div className="space-y-5">
      <form action={action} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <Field label="your name" htmlFor="signup-name">
          <Input id="signup-name" name="name" required autoComplete="name" placeholder="Sam Rivera" />
        </Field>
        <Field label="email" htmlFor="signup-email">
          <Input
            id="signup-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
          />
        </Field>
        <Field label="password" htmlFor="signup-password" hint="8 characters or more">
          <Input
            id="signup-password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Use three or four words"
          />
        </Field>
        <label className="flex items-start gap-2 text-[12px] leading-relaxed text-muted">
          <input
            type="checkbox"
            name="terms"
            required
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            I agree to the{" "}
            <Link href="/terms" className="text-text underline underline-offset-2">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-text underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <OAuthButtons next={next} googleEnabled={googleEnabled} githubEnabled={githubEnabled} />
      <p className="text-center text-[12px] text-muted">
        Already have an account?{" "}
        <button type="button" onClick={onSwitch} className="text-text underline underline-offset-4">
          Sign in
        </button>
      </p>
    </div>
  )
}

function SignInForm({
  next,
  googleEnabled,
  githubEnabled,
  onVerify,
  onSwitch,
}: {
  next: string
  googleEnabled: boolean
  githubEnabled: boolean
  onVerify: (email: string) => void
  onSwitch: () => void
}) {
  const [magicLink, setMagicLink] = useState(false)
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    magicLink ? sendMagicLinkAction : signInEmailAction,
    null,
  )
  useEffect(() => {
    const verification = needsVerification(state)
    if (verification) onVerify(verification.email)
  }, [state, onVerify])
  return (
    <div className="space-y-5">
      <form action={action} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <Field label="email" htmlFor="signin-email">
          <Input
            id="signin-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
          />
        </Field>
        {!magicLink ? (
          <div>
            <Field label="password" htmlFor="signin-password">
              <Input
                id="signin-password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="Your password"
              />
            </Field>
            <div className="mt-1.5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMagicLink(true)}
                className="font-mono text-[11px] text-faint underline underline-offset-2 hover:text-text cursor-pointer"
              >
                email me a sign-in code
              </button>
              <Link
                href="/forgot-password"
                className="font-mono text-[11px] text-faint underline underline-offset-2 hover:text-text"
              >
                forgot password?
              </Link>
            </div>
          </div>
        ) : (
          <div className="text-right">
            <button
              type="button"
              onClick={() => setMagicLink(false)}
              className="font-mono text-[11px] text-faint underline underline-offset-2 hover:text-text cursor-pointer"
            >
              use password instead
            </button>
          </div>
        )}
        {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending
            ? magicLink
              ? "Sending code…"
              : "Signing in…"
            : magicLink
              ? "Send sign-in code"
              : "Sign in"}
        </Button>
      </form>
      <OAuthButtons next={next} googleEnabled={googleEnabled} githubEnabled={githubEnabled} />
      <p className="text-center text-[12px] text-muted">
        New to Sayabot?{" "}
        <button type="button" onClick={onSwitch} className="text-text underline underline-offset-4 cursor-pointer">
          Create an account
        </button>
      </p>
      <p className="text-center font-mono text-[11px] leading-relaxed text-faint">
        Have an invite? Open the link from your email.
      </p>
    </div>
  )
}

function VerifyForm({
  email,
  next,
  onBack,
}: {
  email: string
  next: string
  onBack: () => void
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    verifyEmailAction,
    null,
  )
  const [resendState, resendAction, resendPending] = useActionState<ActionResult | null, FormData>(
    resendVerificationAction,
    null,
  )
  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[12px] text-accent">verify your email</p>
        <h2 className="mt-2 text-xl font-medium tracking-[-0.01em]">Check your inbox</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          We sent a 6-digit code to <span className="text-text">{email}</span>. Use it before it
          expires.
        </p>
      </div>
      <form action={action} className="space-y-4">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
        <CodeInput />
        {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? "Checking…" : "Verify and continue"}
        </Button>
      </form>
      <form action={resendAction} className="flex flex-wrap items-center justify-between gap-2">
        <input type="hidden" name="email" value={email} />
        <button
          type="submit"
          disabled={resendPending}
          className="font-mono text-[12px] text-muted underline underline-offset-4 hover:text-text disabled:opacity-50"
        >
          {resendPending ? "sending…" : "send a new code"}
        </button>
        <button type="button" onClick={onBack} className="font-mono text-[12px] text-faint hover:text-text">
          use a different email
        </button>
      </form>
      {resendState?.message ? <InlineAlert tone="success">{resendState.message}</InlineAlert> : null}
      {resendState && !resendState.ok ? <InlineAlert tone="danger">{resendState.error}</InlineAlert> : null}
      <p className="font-mono text-[11px] leading-relaxed text-faint">
        The email link works too. If no code arrives, check spam, then resend.
      </p>
    </div>
  )
}

export function AuthPanel({
  initialMode = "signup",
  signupNext = "/onboarding",
  signInNext = "/",
  googleEnabled,
  githubEnabled,
  compact = false,
}: {
  initialMode?: Mode
  signupNext?: string
  signInNext?: string
  googleEnabled: boolean
  githubEnabled: boolean
  compact?: boolean
}) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [verification, setVerification] = useState<Verification | null>(null)

  function switchMode(next: Mode) {
    setMode(next)
    setVerification(null)
  }

  return (
    <div
      className={cn(
        "w-full rounded-3xl border border-line/80 bg-panel/90 p-6 sm:p-7 shadow-2xl backdrop-blur-xl",
        compact ? "max-w-sm" : "max-w-[400px]",
      )}
    >
      {verification ? (
        <VerifyForm
          email={verification.email}
          next={verification.next}
          onBack={() => setVerification(null)}
        />
      ) : (
        <>
          <div className="mb-5">
            <h2 className="text-xl font-medium tracking-[-0.01em]">
              {mode === "signup" ? "Create your account" : "Sign in to Sayabot"}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              {mode === "signup"
                ? "Start a shared room for your team and its agents."
                : "Pick up where your rooms left off."}
            </p>
          </div>
          {mode === "signup" ? (
            <SignUpForm
              next={signupNext}
              googleEnabled={googleEnabled}
              githubEnabled={githubEnabled}
              onVerify={(email) => setVerification({ email, next: signupNext })}
              onSwitch={() => switchMode("signin")}
            />
          ) : (
            <SignInForm
              next={signInNext}
              googleEnabled={googleEnabled}
              githubEnabled={githubEnabled}
              onVerify={(email) => setVerification({ email, next: signInNext })}
              onSwitch={() => switchMode("signup")}
            />
          )}
        </>
      )}
      <p className="mt-5 border-t border-line pt-3 font-mono text-[11px] leading-relaxed text-faint">
        You can only see workspaces you belong to.{" "}
        <Link href="/security" className="underline underline-offset-2 hover:text-text">
          Security
        </Link>
        .
      </p>
    </div>
  )
}
