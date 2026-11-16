# Build the Windows installers (NSIS setup + zip used by in-app updates).
# Run this on Windows:
#   pwsh deploy/desktop/package-windows.ps1
# Optional: $env:SAYABOT_WIN_ARM64 = "1" also builds the arm64 installer.
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Error "pnpm is required. Install it, then run this script again."
}

pnpm install --frozen-lockfile
pnpm --filter @sayabot/desktop package:win:x64
if ($env:SAYABOT_WIN_ARM64 -eq "1") {
  pnpm --filter @sayabot/desktop exec electron-builder --win nsis zip --arm64 --publish never
}

Write-Host "Windows installers are in apps/desktop/dist/installers"
Get-ChildItem (Join-Path $root "apps\desktop\dist\installers") -Recurse -Include *.exe,*.zip | ForEach-Object { $_.FullName }
