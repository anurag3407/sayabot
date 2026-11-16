"use client"

import { useEffect } from "react"
import type { Session } from "@supabase/supabase-js"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

interface LiveSession {
  accessToken: string
  refreshToken: string
  email: string
  userId: string
  isGuest: boolean
}

interface DesktopSessionBridge {
  saveLiveSession?: (session: LiveSession) => Promise<unknown>
}

function liveSession(session: Session): LiveSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    email: session.user.email ?? "",
    userId: session.user.id,
    isGuest: session.user.is_anonymous === true,
  }
}

/**
 * The Mac app also stores the login in a file. The page is what refreshes it. Copy each new
 * token into that file so an update does not relaunch with a token the server already replaced.
 */
export function DesktopSessionSync() {
  useEffect(() => {
    const desktop = (window as unknown as { sayabotDesktop?: DesktopSessionBridge }).sayabotDesktop
    if (!desktop?.saveLiveSession) return
    const save = desktop.saveLiveSession.bind(desktop)
    const supabase = createSupabaseBrowserClient()
    const push = (session: Session | null) => {
      if (!session?.access_token || !session.refresh_token) return
      void save(liveSession(session))
    }
    const read = async () => {
      const { data } = await supabase.auth.getSession()
      return data.session ? liveSession(data.session) : null
    }
    ;(window as unknown as { __sayabotReadSession?: typeof read }).__sayabotReadSession = read
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      push(session)
    })
    void supabase.auth.getSession().then(({ data: current }) => push(current.session))
    return () => {
      data.subscription.unsubscribe()
      const holder = window as unknown as { __sayabotReadSession?: typeof read }
      if (holder.__sayabotReadSession === read) delete holder.__sayabotReadSession
    }
  }, [])
  return null
}
