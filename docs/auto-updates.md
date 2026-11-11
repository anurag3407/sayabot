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
  > *"A new version of Sayabot is available. [Refresh to Update]"*

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
  - *Prerequisite*: Add `EXPO_TOKEN` to your GitHub repository secrets.

### B. In-App Version Checker & Self-Hosted APK Downloads
- **When it applies**: Changes to native dependencies, Android permissions, or major releases.
- **Backend Endpoint**: [`GET /api/mobile/version`](../apps/web/src/app/api/mobile/version/route.ts).
  - Can be controlled on your server via environment variables:
    ```bash
    MOBILE_LATEST_VERSION="1.0.1"
    MOBILE_MIN_VERSION="1.0.0"
    MOBILE_APK_URL="/downloads/sayabot-latest.apk"
    MOBILE_RELEASE_NOTES="New tools, improved responsiveness, and fixes."
    ```
- **In-App Settings UI**:
  - Inside **Settings $\to$ About**, users see their current app version and an **Update / Check** button.
  - Tapping **Check** checks both OTA and self-hosted server releases, and prompts the user to install or download immediately.

### C. Building New APKs
- To build a new standalone `.apk` using EAS Cloud Build:
  ```bash
  pnpm mobile:build:apk
  ```
- Or trigger the **Build Standalone APK** workflow dispatch directly from the GitHub Actions web interface.
