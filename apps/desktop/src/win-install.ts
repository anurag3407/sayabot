import { execFile, spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

/**
 * Windows install location and the helper that swaps in an update after Sayabot quits.
 * The download is a zip of the unpacked app (electron-builder `zip` target). The NSIS
 * setup exe is the first-run installer; updates replace the folder that is actually running.
 */

/** Quote a path for a PowerShell single-quoted string. */
export function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** `1.2.3` or `1.2.3.0` (the fourth component electron-builder adds) → `1.2.3`. */
export function normalizeProductVersion(raw: string): string | null {
  const match = /(\d+)\.(\d+)\.(\d+)(?:\.\d+)?/.exec(raw.trim())
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null
}

function programsDir(): string {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
  return path.join(local, "Programs", "Sayabot")
}

/**
 * The folder that contains the running `Sayabot.exe`. A dev Electron binary, or anything that
 * is not Sayabot itself, updates the per-user install folder instead.
 */
export function installTargetWin(exePath: string): string {
  // path.win32 so a Windows exe path parses the same in tests run on macOS.
  if (path.win32.basename(exePath).toLowerCase() === "sayabot.exe")
    return path.win32.dirname(exePath)
  return programsDir()
}

/** Whether this user may replace `target` (its parent must be writable, and the folder itself). */
export function canReplaceWin(target: string): boolean {
  try {
    fs.accessSync(path.dirname(target), fs.constants.W_OK)
    if (fs.existsSync(target)) fs.accessSync(target, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function powershellPath(): string {
  const root = process.env.SystemRoot || "C:\\Windows"
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}

/**
 * Replaces the app after this process exits. Copies the new folder beside the old one, swaps
 * them, and puts the old one back if any step fails. The log is
 * %LOCALAPPDATA%\Sayabot\Logs\update.log.
 */
export function winUpdateInstallScript(opts: {
  zipPath: string
  pid: number
  target: string
  version: string
}): string {
  const q = psSingleQuote
  return `$ErrorActionPreference = 'Stop'
$Zip = ${q(opts.zipPath)}
$Target = ${q(opts.target)}
$Expected = ${q(opts.version)}
$PidToWait = ${opts.pid}
$Log = Join-Path $env:LOCALAPPDATA 'Sayabot\\Logs\\update.log'
New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null
Start-Transcript -Path $Log -Append | Out-Null
Write-Output "installing Sayabot $Expected into $Target"
$Parent = Split-Path $Target -Parent
$Leaf = Split-Path $Target -Leaf
$NewDir = Join-Path $Parent ($Leaf + '.new')
$OldDir = Join-Path $Parent ($Leaf + '.old')
$Extract = Join-Path $env:TEMP ('sayabot-update-extract-' + [guid]::NewGuid().ToString('n'))
function Fail([string]$Why) {
  Write-Output "update failed: $Why"
  if (Test-Path $Extract) { Remove-Item -LiteralPath $Extract -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $NewDir) { Remove-Item -LiteralPath $NewDir -Recurse -Force -ErrorAction SilentlyContinue }
  $exe = Join-Path $Target 'Sayabot.exe'
  if (-not (Test-Path -LiteralPath $exe) -and (Test-Path -LiteralPath $OldDir)) {
    if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue }
    Rename-Item -LiteralPath $OldDir -NewName $Leaf
  }
  $back = Join-Path $Target 'Sayabot.exe'
  if (Test-Path -LiteralPath $back) { Start-Process -FilePath $back }
  Stop-Transcript | Out-Null
  exit 1
}
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Process -Id $PidToWait -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) {
  Start-Sleep -Milliseconds 200
}
if (Get-Process -Id $PidToWait -ErrorAction SilentlyContinue) { Fail 'Sayabot did not quit' }
try { Expand-Archive -LiteralPath $Zip -DestinationPath $Extract -Force } catch { Fail 'could not open the zip' }
$found = Get-ChildItem -LiteralPath $Extract -Filter 'Sayabot.exe' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName.Split([IO.Path]::DirectorySeparatorChar).Count -le ($Extract.Split([IO.Path]::DirectorySeparatorChar).Count + 3) } |
  Select-Object -First 1
if (-not $found) { Fail 'no Sayabot.exe in the zip' }
$got = (Get-Item -LiteralPath $found.FullName).VersionInfo.ProductVersion
if ($got -notlike ($Expected + '*')) { Fail "the zip has version '$got', expected $Expected" }
$src = Split-Path $found.FullName -Parent
if (Test-Path $NewDir) { Remove-Item -LiteralPath $NewDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $NewDir | Out-Null
& robocopy $src $NewDir /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { Fail 'could not copy the new app' }
if (Test-Path -LiteralPath $Target) {
  if (Test-Path $OldDir) { Remove-Item -LiteralPath $OldDir -Recurse -Force }
  try { Rename-Item -LiteralPath $Target -NewName ($Leaf + '.old') } catch { Fail 'could not move the old app aside' }
}
try { Rename-Item -LiteralPath $NewDir -NewName $Leaf } catch { Fail 'could not put the new app in place' }
if (Test-Path $OldDir) { Remove-Item -LiteralPath $OldDir -Recurse -Force }
Remove-Item -LiteralPath $Extract -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
Write-Output "installed Sayabot $Expected"
Start-Process -FilePath (Join-Path $Target 'Sayabot.exe')
Stop-Transcript | Out-Null
`
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 120_000, windowsHide: true }, (error, stdout) =>
      error ? reject(error) : resolve(String(stdout)),
    ),
  )
}

/** Expands the zip just long enough to read Sayabot.exe's product version. */
export async function inspectWinZip(zipPath: string): Promise<string | null> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sayabot-win-inspect-"))
  const ps = powershellPath()
  try {
    await run(ps, [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath ${psSingleQuote(zipPath)} -DestinationPath ${psSingleQuote(dir)} -Force`,
    ])
    const exe = findExe(dir)
    if (!exe) return null
    const version = await run(ps, [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Item -LiteralPath ${psSingleQuote(exe)}).VersionInfo.ProductVersion`,
    ])
    return normalizeProductVersion(version)
  } catch {
    return null
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function findExe(root: string): string | null {
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const depth = full.split(path.sep).length - root.split(path.sep).length
        if (depth <= 3) stack.push(full)
      } else if (entry.name.toLowerCase() === "sayabot.exe") {
        return full
      }
    }
  }
  return null
}

/** Writes the helper and returns its path. The caller starts it, then quits. */
export function stageWinUpdate(opts: { zipPath: string; target: string; version: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sayabot-update-"))
  const scriptPath = path.join(dir, "install.ps1")
  fs.writeFileSync(scriptPath, winUpdateInstallScript({ ...opts, pid: process.pid }), "utf8")
  return scriptPath
}

export function runDetachedWin(scriptPath: string): void {
  spawn(
    powershellPath(),
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    { detached: true, stdio: "ignore", windowsHide: true },
  ).unref()
}
