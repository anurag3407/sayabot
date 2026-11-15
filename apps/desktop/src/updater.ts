/**
 * The Mac app's own updates, as one state machine the menu, the notification and the workspace
 * page all read, so they never disagree. Checking asks the Sayabot server which version is newest;
 * installing downloads that exact version's DMG, makes sure it really is that version, and only
 * then quits so a helper can swap the app (see mac-install.ts).
 */

export type UpdateState =
  | { status: "idle"; current: string; latest: string | null; checkedAt: number | null }
  | { status: "checking"; current: string; latest: string | null }
  | { status: "available"; current: string; latest: string; notes: string }
  | { status: "downloading"; current: string; latest: string; percent: number | null }
  | { status: "installing"; current: string; latest: string }
  | { status: "error"; current: string; latest: string | null; message: string }

export interface VersionInfo {
  latestDesktopVersion?: string
  dmgUrl?: string
  dmgUrls?: Partial<Record<"arm64" | "x64", string>>
  releaseNotes?: string
}

export interface UpdaterDeps {
  currentVersion: string
  arch: string
  fetchVersion: () => Promise<VersionInfo>
  download: (url: string, dest: string, onProgress: (percent: number | null) => void) => Promise<void>
  /** The CFBundleShortVersionString of the Sayabot.app inside a DMG, or null. */
  inspect: (dmgPath: string) => Promise<string | null>
  /** Throws a plain-words error when the app cannot replace itself where it lives. */
  install: (dmgPath: string, version: string) => Promise<void>
  dmgPath: (version: string) => string
}

export class NotPublishedError extends Error {}

const REPO_DOWNLOADS = "https://github.com/anurag3407/sayabot/releases/download"

export function parseVersion(v: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** True only when both are real x.y.z versions and `latest` is higher. */
export function isNewer(current: string, latest: string): boolean {
  const a = parseVersion(current)
  const b = parseVersion(latest)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (b[i]! !== a[i]!) return b[i]! > a[i]!
  }
  return false
}

/**
 * The DMG for exactly `version` on this Mac's chip. A "latest" link could hand over a different
 * build than the one the check saw, so it is pinned to the version's own release.
 */
export function dmgUrlFor(info: VersionInfo, version: string, arch: string): string {
  const chip = arch === "x64" ? "x64" : "arm64"
  const pinned = info.dmgUrls?.[chip]
  if (pinned) return pinned
  const name = `Sayabot-${chip}.dmg`
  const given = info.dmgUrl
  if (given && !given.includes("/releases/latest/download/")) {
    return given.replace(/Sayabot-(arm64|x64)\.dmg$/, name)
  }
  return `${REPO_DOWNLOADS}/v${version}/${name}`
}

export class DesktopUpdater {
  private state: UpdateState
  private info: VersionInfo | null = null
  private checking: Promise<UpdateState> | null = null
  private listeners = new Set<(state: UpdateState) => void>()

  constructor(private deps: UpdaterDeps) {
    this.state = { status: "idle", current: deps.currentVersion, latest: null, checkedAt: null }
  }

  get current(): UpdateState {
    return this.state
  }

  onChange(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(next: UpdateState) {
    this.state = next
    for (const listener of this.listeners) listener(next)
  }

  private get busy(): boolean {
    return this.state.status === "downloading" || this.state.status === "installing"
  }

  /**
   * Asks which version is newest. An automatic check that fails keeps what we knew (a flaky
   * network should not flash an error); a check you asked for reports the failure.
   */
  check(manual = false): Promise<UpdateState> {
    if (this.busy) return Promise.resolve(this.state)
    if (this.checking) return this.checking
    const before = this.state
    const current = this.deps.currentVersion
    this.set({ status: "checking", current, latest: "latest" in before ? before.latest : null })
    this.checking = (async () => {
      try {
        const info = await this.deps.fetchVersion()
        const latest = info.latestDesktopVersion ?? ""
        if (!parseVersion(latest)) throw new Error("The server did not say which version is newest.")
        this.info = info
        this.set(
          isNewer(current, latest)
            ? { status: "available", current, latest, notes: info.releaseNotes?.trim() || "" }
            : { status: "idle", current, latest, checkedAt: Date.now() },
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (manual) this.set({ status: "error", current, latest: null, message: `Could not check for updates. ${message}` })
        else this.set(before.status === "checking" ? { status: "idle", current, latest: null, checkedAt: null } : before)
      } finally {
        this.checking = null
      }
      return this.state
    })()
    return this.checking
  }

  /** Downloads, verifies and installs the newest version. Safe to call twice: the second waits. */
  async install(): Promise<void> {
    if (this.busy) return
    if (this.state.status !== "available") {
      const checked = await this.check(true)
      if (checked.status !== "available") return
    }
    const state = this.state
    if (state.status !== "available" || !this.info) return
    const { current, latest } = state
    const dmgPath = this.deps.dmgPath(latest)
    const url = dmgUrlFor(this.info, latest, this.deps.arch)
    this.set({ status: "downloading", current, latest, percent: 0 })
    try {
      let shown = -1
      await this.deps.download(url, dmgPath, (percent) => {
        const whole = percent === null ? null : Math.floor(percent)
        if (whole !== null && whole === shown) return
        shown = whole ?? -1
        this.set({ status: "downloading", current, latest, percent: whole })
      })
      const found = await this.deps.inspect(dmgPath)
      if (found !== latest) {
        throw new Error(
          found
            ? `The download is version ${found}, not ${latest}. Nothing was changed.`
            : "The download could not be opened. Nothing was changed.",
        )
      }
      this.set({ status: "installing", current, latest })
      await this.deps.install(dmgPath, latest)
    } catch (error) {
      const message =
        error instanceof NotPublishedError
          ? `Sayabot ${latest} is still being published. Try again in a few minutes.`
          : error instanceof Error
            ? error.message
            : String(error)
      this.set({ status: "error", current, latest, message })
    }
  }
}
