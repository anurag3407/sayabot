// electron-builder afterSign hook.
//
// Until we have an Apple Developer ID (see docs/macos-signing-and-notarization.md),
// electron-builder skips signing and leaves Electron's stock "linker-signed" ad-hoc signature,
// which only covers the main binary. After the app is renamed and its resources are added, that
// signature no longer matches the bundle, so a downloaded copy is reported as
// "Sayabot is damaged and can't be opened" on Apple silicon, with no way past it.
//
// Ad-hoc signing the whole bundle makes the signature consistent again. macOS then shows the
// normal "could not verify" warning, which users can bypass with
// System Settings → Privacy & Security → Open Anyway.
//
// When a real Developer ID signature is present, verification passes and this hook does nothing.

const { execFileSync } = require("node:child_process")
const path = require("node:path")

function signatureIsValid(appPath) {
  try {
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  if (signatureIsValid(appPath)) {
    console.log(`  • signature valid, skipping ad-hoc signing  app=${appPath}`)
    return
  }

  console.log(`  • no valid signature, ad-hoc signing (no Developer ID yet)  app=${appPath}`)
  // No --options runtime: the hardened runtime's library validation would refuse to load
  // Electron's frameworks under an ad-hoc signature (there's no Team ID to match).
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" })

  if (!signatureIsValid(appPath)) {
    throw new Error(`ad-hoc signature did not verify for ${appPath}`)
  }
}
