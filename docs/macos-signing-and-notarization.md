# macOS Code Signing & Notarization (Sayabot Desktop)

> **Status:** not set up yet. We have no Apple Developer ID. Until we do, downloaded builds of
> `Sayabot.app` are **unsigned** and macOS Gatekeeper blocks them on first open.
> This guide is the full checklist to follow once the Apple Developer Program membership is bought.

App: [`apps/desktop`](../apps/desktop) · Builder: `electron-builder` 26 · Bundle ID: `in.sayalabs.sayabot.desktop`

---

## 1. Why we need it

| | Unsigned (today) | Signed + notarized |
| --- | --- | --- |
| First open | "Apple could not verify 'Sayabot' is free of malware". User must go to **System Settings → Privacy & Security → Open Anyway** | Opens normally |
| Screen recording / Accessibility / Apple Events permissions | Can reset on every rebuild (no stable identity) | Granted once, kept across updates |
| Native auto-updates (`electron-updater` / Squirrel.Mac) | Not possible, Squirrel refuses unsigned apps | Possible |
| Trust | "Unidentified developer" | Shows our name or company |

Note: on macOS 15 (Sequoia) and later, **Control-click → Open no longer bypasses Gatekeeper**.
Unsigned apps can only be opened through System Settings → Privacy & Security → **Open Anyway**.

### What we do until then: ad-hoc signing

Without any signature fix, a downloaded build shows **"Sayabot is damaged and can't be opened"**,
and there's no way past it in the UI. That happens because Electron's stock signature no longer
matches the bundle after packaging. [`apps/desktop/build/adhoc-sign.cjs`](../apps/desktop/build/adhoc-sign.cjs)
(electron-builder `afterSign`) ad-hoc signs the whole app when no valid signature is present, so
users get the normal "could not verify" warning and can use **Open Anyway**. Once a Developer ID
signs the app, the hook sees a valid signature and does nothing. You don't need to remove it.

### How releases and updates work today

- **Pushing to `main`** deploys the web app. The Mac app loads the workspace from the server, so
  web changes reach it on the next reload. Code inside the app (`apps/desktop/**`: guest mode,
  the start page, the host) does not. It ships only in a new DMG.
- **[`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml)** builds
  both DMGs on every push that touches `apps/desktop/**` (or by hand: Actions → Desktop Release →
  Run workflow). It publishes them as release `v<major>.<minor>.<run number>` and marks it latest.
  The Android APKs are copied over from the previous release so their download links keep working.
- **`/api/version`** reports `latestDesktopVersion` from that latest release tag (cached 10 min;
  `DESKTOP_LATEST_VERSION` overrides it).
- **The app** checks 15 s after launch and every 6 h. When a newer version exists, it offers
  **Download Update**, which opens the DMG for this Mac's architecture. Installing is manual (drag
  to Applications, replace). Each new ad-hoc build asks for **Open Anyway** again, because macOS
  ties that approval to the exact build. Self-installing updates need the Developer ID (section 8).

### Workaround for testers until we're signed

```bash
# After dragging Sayabot.app into /Applications:
xattr -dr com.apple.quarantine /Applications/Sayabot.app
```

---

## 2. Buy & enroll (one time)

1. Enroll at <https://developer.apple.com/programs/enroll/>. It costs **$99 USD/year**.
   - **Individual**: fastest, usually approved in about a day. The app shows your personal name as the developer.
   - **Organization** (e.g. "Saya Labs"): needs a **D-U-N-S number** (free, can take 1–2 weeks) and a
     legal entity. The app shows the company name. Pick this if we want the company name on the app.
2. Turn on **two-factor authentication** on the Apple ID (required).
3. Write down the **Team ID**: developer.apple.com → Account → Membership details (10 characters, e.g. `AB12CD34EF`).

---

## 3. Create the "Developer ID Application" certificate

This is the certificate for apps distributed **outside** the Mac App Store. It is not the "Apple
Development" or "Mac App Distribution" certificate. Only the **Account Holder** role can create it.

**Easiest (Xcode):**
1. Xcode → Settings → Accounts → add the Apple ID → select the team → **Manage Certificates…**
2. Click **+** → **Developer ID Application**.
3. It's now in your login Keychain as `Developer ID Application: <Name> (<TEAM_ID>)`.

**Without Xcode:**
1. Keychain Access → Certificate Assistant → *Request a Certificate From a Certificate Authority* →
   save to disk.
2. developer.apple.com → Certificates → **+** → *Developer ID Application* (G2 Sub-CA) → upload the CSR.
3. Download the `.cer` and double-click it to install.

Check that it's there:

```bash
security find-identity -v -p codesigning
# → 1) ABCDEF… "Developer ID Application: Saya Labs (AB12CD34EF)"
```

### Export it for CI

Keychain Access → My Certificates → right-click the Developer ID Application cert (expand it so the
**private key** is included) → *Export…* → `.p12` → set a strong password.

```bash
base64 -i DeveloperID.p12 | pbcopy   # paste into the CSC_LINK GitHub secret
```

> 🔐 The `.p12` and its password are secrets (AGENTS.md Rule 1). Never commit them. Keep them in
> GitHub Actions secrets or a password manager only.

---

## 4. Notarization credentials

Pick **one** method. The App Store Connect API key is recommended: it isn't tied to a person's
password and doesn't break when 2FA or passwords change.

### Option A (recommended): App Store Connect API key

1. <https://appstoreconnect.apple.com/access/integrations/api> → **Team Keys** → **+**
   → Name `sayabot-notary`, Access **Developer**.
2. Download `AuthKey_XXXXXXXXXX.p8`. **You can only download it once.**
3. Note the **Key ID** and the **Issuer ID** (shown above the table).

| Env var | Value |
| --- | --- |
| `APPLE_API_KEY` | Path to the `.p8` file |
| `APPLE_API_KEY_ID` | Key ID |
| `APPLE_API_ISSUER` | Issuer ID (UUID) |

### Option B: Apple ID + app-specific password

1. <https://account.apple.com> → Sign-In and Security → **App-Specific Passwords** → generate one.

| Env var | Value |
| --- | --- |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | `xxxx-xxxx-xxxx-xxxx` |
| `APPLE_TEAM_ID` | Team ID from step 2 |

---

## 5. Changes to make in the repo (when we're ready)

### 5.1 `apps/desktop/package.json` → `build.mac`

```jsonc
"mac": {
  // …existing fields stay…
  "hardenedRuntime": true,          // already set, required for notarization
  "gatekeeperAssess": false,        // already set
  "notarize": true,                 // ADD: electron-builder notarizes + staples after signing
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist"
}
```

electron-builder finds the signing identity automatically: either the Keychain (locally) or
`CSC_LINK` / `CSC_KEY_PASSWORD` (CI). To pin a specific one when there are several, set
`"identity": "Saya Labs (AB12CD34EF)"` (no `Developer ID Application:` prefix).

### 5.2 `apps/desktop/build/entitlements.mac.plist`

The current file is fine for Electron but needs two adjustments before signing:

```xml
<!-- ADD: the app types for you via System Events during remote desktop sessions
     (NSAppleEventsUsageDescription). With the hardened runtime, Apple Events are blocked
     unless this entitlement is present. -->
<key>com.apple.security.automation.apple-events</key>
<true/>

<!-- REVIEW: lets the app attach a debugger to other processes. Not needed for normal use,
     and it looks suspicious in security reviews. Remove it unless something depends on it. -->
<key>com.apple.security.cs.debugger</key>
<true/>
```

Keep `cs.allow-jit` and `cs.allow-unsigned-executable-memory` (Electron/V8 needs them) and the
`network.client` / `network.server` keys.

If a future native module (e.g. a `.node` addon or an unsigned helper binary) fails to load after
signing, add `com.apple.security.cs.disable-library-validation`.

Never add `com.apple.security.get-task-allow`: notarization rejects it.

### 5.3 Optional: sign the DMG too

Notarizing and stapling the **app** is enough for Gatekeeper. If we also want the `.dmg` itself to
show as signed:

```jsonc
"dmg": { "sign": true, /* …existing… */ }
```

---

## 6. Build a signed + notarized release locally

```bash
# Option A credentials
export APPLE_API_KEY=~/secrets/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Cert is in the login Keychain, so no CSC_* needed locally.
pnpm --filter @sayabot/desktop package:mac      # dmg + zip, current arch
pnpm --filter @sayabot/desktop package:arm64    # Apple silicon
pnpm --filter @sayabot/desktop package:x64      # Intel
```

Notarization uploads the app to Apple and waits. It usually takes **1–10 minutes**; the first
submission can take longer. Output lands in `apps/desktop/dist/installers/`.

### Verify

```bash
APP="apps/desktop/dist/installers/mac-arm64/Sayabot.app"

codesign --verify --deep --strict --verbose=2 "$APP"          # signature valid
codesign -dvv "$APP" 2>&1 | grep -E "Authority|TeamIdentifier" # shows Developer ID + team
codesign -d --entitlements - "$APP"                           # entitlements as shipped
spctl --assess --type execute -vvv "$APP"                     # → "accepted, source=Notarized Developer ID"
xcrun stapler validate "$APP"                                 # → "The validate action worked!"
```

Last check: download the DMG through a browser (so it gets the quarantine flag) on a
**different Mac** and open it. It should open with no Gatekeeper warning.

---

## 7. CI: GitHub Actions release workflow (template)

Add these **repository secrets**:

| Secret | Contents |
| --- | --- |
| `CSC_LINK` | base64 of the `.p12` (step 3) |
| `CSC_KEY_PASSWORD` | `.p12` password |
| `APPLE_API_KEY_P8` | contents of `AuthKey_XXXXXXXXXX.p8` |
| `APPLE_API_KEY_ID` | Key ID |
| `APPLE_API_ISSUER` | Issuer ID |

Then create `.github/workflows/desktop-release.yml`:

```yaml
name: Desktop release (macOS)

on:
  push:
    tags: ["desktop-v*"]
  workflow_dispatch:

jobs:
  mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      - name: Write App Store Connect API key
        run: |
          mkdir -p ~/private_keys
          echo "$APPLE_API_KEY_P8" > ~/private_keys/AuthKey.p8
        env:
          APPLE_API_KEY_P8: ${{ secrets.APPLE_API_KEY_P8 }}

      - name: Build, sign & notarize (arm64 + x64)
        run: |
          pnpm --filter @sayabot/desktop build
          cd apps/desktop && npx electron-builder --mac --arm64 --x64 --publish never
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_API_KEY: ~/private_keys/AuthKey.p8
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}

      - uses: actions/upload-artifact@v4
        with:
          name: sayabot-mac
          path: |
            apps/desktop/dist/installers/*.dmg
            apps/desktop/dist/installers/*.zip
```

> Use `$HOME/private_keys/AuthKey.p8` if `~` isn't expanded in your runner's env.

Optional, for stable download links like OpenMausBot's `releases/latest/download/Sayabot.dmg`:
set `"artifactName": "Sayabot-${arch}.${ext}"` in `build.mac`, then attach the files to a GitHub
Release (`softprops/action-gh-release`).

---

## 8. After signing: things it unlocks

- **Native auto-updates.** Add `electron-updater` with a GitHub Releases or S3 `publish` provider.
  Squirrel.Mac only installs updates that carry the **same Developer ID**, so never rotate to a
  different team. Today the app only relaunches (the workspace UI updates from the web), which is
  why this isn't needed yet.
- **Stable macOS permissions.** Screen Recording and Accessibility grants are tied to the signing
  identity, so they survive updates once the identity stays the same.
- **Universal build.** `electron-builder --mac --universal` ships one DMG for both Apple silicon and Intel.

---

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `skipped macOS application code signing … cannot find valid "Developer ID Application" identity` | Cert not in Keychain, or it's an "Apple Development" cert. Re-check `security find-identity -v -p codesigning`. In CI, check that `CSC_LINK` is the base64 `.p12` **with private key**. |
| `The binary is not signed with a valid Developer ID certificate` | A helper or native binary wasn't signed. Make sure it sits inside the `.app` (electron-builder signs everything in `Contents/`). |
| `The executable does not have the hardened runtime enabled` | `hardenedRuntime: true` missing (already set; don't remove it). |
| `The executable requests the com.apple.security.get-task-allow entitlement` | Remove that key from the entitlements plist. |
| Notarization hangs or fails with no detail | Get the log: `xcrun notarytool log <submission-id> --key $APPLE_API_KEY --key-id $APPLE_API_KEY_ID --issuer $APPLE_API_ISSUER` |
| App crashes on launch only after signing | Usually a missing entitlement: `allow-jit` / `allow-unsigned-executable-memory`, or `disable-library-validation` for unsigned native addons. Check Console.app for "Code Signature Invalid". |
| Typing into apps during remote desktop stops working after signing | `com.apple.security.automation.apple-events` missing (section 5.2). |
| `errSecInternalComponent` in CI | Keychain locked. electron-builder creates a temp keychain from `CSC_LINK`; don't also import the cert manually. |

---

## 10. Checklist

- [ ] Apple Developer Program purchased (Individual or Organization)
- [ ] Team ID noted
- [ ] "Developer ID Application" certificate created and exported as `.p12`
- [ ] App Store Connect API key (`.p8`, Key ID, Issuer ID) created and stored safely
- [ ] `"notarize": true` added to `build.mac`
- [ ] Entitlements updated (add `automation.apple-events`, review `cs.debugger`)
- [ ] Local signed build passes every check in section 6
- [ ] GitHub secrets added and `desktop-release.yml` created
- [ ] Download page / README points at the signed DMGs
- [ ] Remove the `xattr` workaround from tester instructions
