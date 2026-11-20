# Auto-Updates Architecture & Guide

Sayabot is architected across multiple distribution channels: **Web Application**, **macOS Desktop (PWA / Daemon)**, and **Android Mobile (APK)**. This guide outlines how updates flow across all three targets whenever you push code changes.

---

## 1. Web Application (`apps/web`)

### Continuous Deployment (CI/CD)

- **Trigger**: Every push to the `main` branch.
- **Workflow**: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).
- **Process**: Connects via SSH to your Lightsail VPS, pulls `origin/main`, executes [`deploy/deploy.sh`](../deploy/deploy.sh), rebuilds Docker containers, runs Prisma migrations, and restarts services with zero downtime.

### Client-Side PWA Service Worker

- Built using **Serwist** (`@serwist/next`).
- Configured with `skipWaiting: true` and `clientsClaim: true`.
- Monitored by [`PwaUpdatePrompt`](../apps/web/src/components/pwa-update-prompt.tsx) in `apps/web/src/app/layout.tsx`.
- Whenever a new release is rolled out, active tabs or macOS Dock apps receive a non-intrusive toast:
  > _"A new version of Sayabot is available. [Refresh to Update]"_

---

## 2. macOS Desktop

### A. Safari / Chrome "Add to Dock" (PWA Desktop App)

If you install Sayabot on macOS via Safari (**File $\to$ Add to Dock**) or Chrome (**Install App**):

- It shares the live web application bundle and service worker.
- When new code is deployed to your VPS, the macOS Dock app automatically updates upon refresh or when the `PwaUpdatePrompt` toast is clicked.

### B. Local Host Sandbox Daemon (`apps/computerd`)

If you run `computerd` locally on your Mac to allow cloud agents to control your host machine:

- Run the automated update script anytime:
  ```bash
  ./apps/computerd/scripts/update.sh
  ```
- This fetches the latest commits from `origin/main`, updates dependencies, and re-verifies TypeScript types.

---

## 3. Android Mobile APK (`apps/mobile`)

Because mobile applications are compiled native binaries, updates are split into **Over-The-Air (OTA)** updates and **Native Binary (APK)** updates:

### A. Over-The-Air (OTA) Updates via `expo-updates`

- **When it applies**: Any changes to UI, React components, styles, hooks, or business logic.
- **How it works**:
  - The installed APK on Android connects to Expo Application Services (EAS) on startup (`ON_LOAD`).
  - Downloads the new JavaScript bundle silently in the background.
  - Automatically loads the new bundle on the next launch, or prompts the user to reload immediately.
- **Triggering an OTA update manually**:
  ```bash
  pnpm mobile:update
  # Or: cd apps/mobile && npx eas-cli update --auto --branch production
  ```
- **Automated in GitHub Actions**:
  - [`.github/workflows/mobile-updates.yml`](../.github/workflows/mobile-updates.yml) automatically publishes an OTA update whenever changes are pushed to `apps/mobile/**`.
  - _Prerequisite_: Add `EXPO_TOKEN` to your GitHub repository secrets.
  - _One-time Expo setup_: link the channel the APK asks for to the branch CI publishes to: `npx eas-cli channel:edit production --branch production`. APKs from 1.2.1 send `expo-channel-name: production`; 1.2.0 did not, so it can only update by APK.

### B. New APKs (native changes) — automatic

- **When it applies**: Changes to native dependencies, Android permissions, or anything outside the JS bundle.
- **How to release**: bump `"version"` in `apps/mobile/app.json` (e.g. `1.2.0` → `1.3.0`) and push to `main`. The `release-apk` job in [`.github/workflows/mobile-updates.yml`](../.github/workflows/mobile-updates.yml) builds the APK with Gradle and attaches `Sayabot-<version>.apk` (plus `Sayabot.apk`) to the latest GitHub release. No secret is needed. `versionName`, `versionCode` and the OTA runtime version are all derived from that one field.
- **How phones pick it up**: [`GET /api/mobile/version`](../apps/web/src/app/api/mobile/version/route.ts) reports the newest `Sayabot-x.y.z.apk` on GitHub Releases. Within 30 minutes of opening the app, a card offers **Install**. Sayabot then downloads the APK in-app and opens Android's installer (Android always asks for a final confirmation for sideloaded apps).
- **Pinning by hand** (optional): set these on your server to override the GitHub lookup:
  ```bash
  MOBILE_LATEST_VERSION="1.3.0"
  MOBILE_APK_URL="https://example.com/Sayabot-1.3.0.apk"
  MOBILE_RELEASE_NOTES="New tools, improved responsiveness, and fixes."
  MOBILE_RELEASES_REPO="owner/repo"   # follow a fork's releases instead
  ```
- **Manual check**: **More → Check for updates** runs the same OTA and APK checks immediately.

### C. Signing key: set this up before the first automatic release

Android only installs an update signed with the same key as the app already on the phone. Add these repo secrets so every CI-built APK is signed with one private key:

| Secret                      | Value                        |
| :-------------------------- | :--------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | `base64 -i release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password            |
| `ANDROID_KEY_ALIAS`         | key alias                    |
| `ANDROID_KEY_PASSWORD`      | key password                 |

Without them, CI signs with the repo's public `debug.keystore` and prints a warning. The published 1.1.0 APK was signed with a different key (SHA-256 `06be1fdb…`). If that is your EAS-managed key, download it with `eas credentials` (Android → Keystore → Download) and use it here, so 1.2.0 installs over 1.1.0 in place.

### D. One-time step for phones on APK 1.1.0 or older

Those builds shipped without an Expo update URL, and were built without `EXPO_PUBLIC_SUPABASE_URL`, so code sign-in failed with "This copy of the app is set up for a different Sayabot server". Install 1.2.0 once by hand from the download page. If it was signed with a different key, uninstall 1.1.0 first. From then on, updates arrive automatically.

### E. Building an APK by hand

- Locally: `cd apps/mobile/android && ./gradlew assembleRelease`. Output: `app/build/outputs/apk/release/app-release.apk`.
- From GitHub: run **Mobile Updates & Release** with action `build-apk`, which always rebuilds.
- With EAS Cloud Build: `pnpm mobile:build:apk` (needs `EXPO_TOKEN`).
