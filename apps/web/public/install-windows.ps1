# Install Sayabot for Windows without hunting for the file in a browser.
#   irm https://sayabot.sayalabs.in/install-windows.ps1 | iex
$ErrorActionPreference = "Stop"

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$url = "https://github.com/anurag3407/sayabot/releases/latest/download/Sayabot-Setup-$arch.exe"
$dest = Join-Path $env:TEMP "Sayabot-Setup-$arch.exe"

Write-Host "Downloading Sayabot for Windows ($arch)…"
Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing

Get-Process -Name "Sayabot" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

Write-Host "Installing…"
$proc = Start-Process -FilePath $dest -ArgumentList "/S" -PassThru -Wait
if ($proc.ExitCode -ne 0) {
  Write-Error "The installer exited with code $($proc.ExitCode)."
}

$exe = Join-Path $env:LOCALAPPDATA "Programs\Sayabot\Sayabot.exe"
if (-not (Test-Path -LiteralPath $exe)) {
  Write-Error "Sayabot installed, but $exe is missing. Open Sayabot from the Start menu."
}

Write-Host "Opening Sayabot."
Start-Process -FilePath $exe
