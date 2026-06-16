# AI Video Production Editor - Technical Build Guide

### 1. Prerequisites and Environment Setup

Before building the application, ensure your development environment meets the following requirements:

*   **Node.js:** You must have Node.js 20.19 or newer, or Node.js 22.12 or newer. Node 22 LTS is recommended.
*   **Operating System:**
    *   **macOS:** Required only if you want to build and notarize `.dmg` or `.app` files yourself.
    *   **Windows:** Required only if you want to build `.exe` files locally.
*   **Google Gemini API Key:** The application uses a "Bring Your Own Key" (BYOK) model. While not required for the *build* process, a key (paid tier recommended for Veo integration) is required to run and test the app features.
*   **Apple Developer Account:** Required only for maintainers who publish official signed and notarized macOS releases. End users download the notarized `.dmg` from GitHub Releases.

**Environment Configuration:**
For normal local development, copy `.env.example` to `.env.local` and keep real provider keys out of git.
For macOS notarization, export the Apple variables in your shell or keep them in a local ignored `.env` file, because `scripts/notarize.js` loads `.env` during packaging.

```bash
# Development overrides
cp .env.example .env.local

# Optional notarization values for a local ignored .env or shell environment
APPLE_ID=your-apple-id@example.com
APPLE_APP_SPECIFIC_PASSWORD=your-app-specific-password-here
APPLE_TEAM_ID=your-team-id
# Optional: NOTARYTOOL_KEYCHAIN_PROFILE=your-keychain-profile
```

---

### 2. Installation Commands

Open your terminal in the project root folder and install the dependencies defined in `package.json`:

```bash
npm install
```

This installs core dependencies like `react`, `electron`, `vite`, and `@google/genai`, as well as dev dependencies like `electron-builder` and `tailwindcss`.

---

### 3. Build Scripts Explanation

The `package.json` file defines several scripts to handle development, building, and packaging. Here is how they function:

*   **`npm run dev`**
    *   **Command:** `vite`
    *   **Function:** Runs the React renderer process in development mode using Vite. It does not start Electron.
*   **`npm run preview`**
    *   **Command:** `vite preview`
    *   **Function:** Boots up a local static web server to preview the production build of the renderer.

*   **`npm run electron:dev`**
    *   **Command:** `node scripts/build-main.js && concurrently "npm run dev" "wait-on tcp:5173 && electron ."`
    *   **Function:** This is the main command for local development. It runs two processes concurrently:
        1.  Bundles the Electron main and preload scripts into `dist-electron/`.
        2.  Starts the Vite dev server (`npm run dev`) on port 5173.
        3.  Waits for port 5173 to be ready.
        4.  Launches the Electron main process (`electron .`) which loads the dev server URL.

*   **`npm run build`** (Full App Build)
    *   **Command:** `tsc -p tsconfig.build.json && vite build && node scripts/build-main.js`
    *   **Function:** Compiles the TypeScript code, produces the production-ready static assets (HTML, CSS, JS) in the `dist/` folder, and bundles the Electron main/preload files into `dist-electron/`. This is a prerequisite for the Electron package build.

*   **`npm run build:web`** (Renderer Build)
    *   **Command:** `tsc -p tsconfig.build.json && vite build`
    *   **Function:** Compiles only the web renderer into `dist/`.

*   **`npm run electron:build`** (Production Distribution)
    *   **Command:** `npm run build && electron-builder`
    *   **Function:**
        1.  Runs `npm run build` to create fresh renderer assets.
        2.  Runs `electron-builder` to package the Electron application into a distributable format (e.g., `.dmg`, `.exe`) based on the current OS and configuration in `package.json`.

*   **GitHub desktop release workflow**
    *   **File:** `.github/workflows/desktop-release.yml`
    *   **Function:** Runs tests and public-release checks, builds the local Electron macOS `.dmg` and Windows `.exe`, uploads them as workflow artifacts, and attaches both installers to a GitHub Release when a version tag such as `v0.1.0-open-source` is pushed.
    *   **Note:** Public tag releases require Apple signing secrets for macOS. Manual workflow runs can build unsigned test artifacts, but tag-triggered GitHub Releases fail if signing/notarization secrets are missing. With Apple signing secrets present, the workflow imports the Developer ID Application certificate, signs the app, runs notarization, verifies the notarized app, and publishes the resulting `.dmg` plus Windows `.exe` as GitHub Release assets.

Required GitHub Actions secrets for signed macOS releases:

*   `MACOS_CERTIFICATE_BASE64`: base64-encoded Developer ID Application `.p12`
*   `MACOS_CERTIFICATE_PASSWORD`: password used when exporting the `.p12`
*   `APPLE_ID`: Apple Developer account email
*   `APPLE_APP_SPECIFIC_PASSWORD`: app-specific Apple ID password
*   `APPLE_TEAM_ID`: Apple Developer Team ID

Maintainers can set these secrets with:

```bash
./scripts/set-github-release-secrets.sh
```

Before running the script, export only the `Developer ID Application` identity
from Keychain Access as a password-protected `.p12` file. The script uploads the
values with `gh secret set` and removes its temporary base64 file afterward.

To create `MACOS_CERTIFICATE_BASE64` on macOS after exporting the certificate
from Keychain Access:

```bash
base64 -i cert.p12 | pbcopy
```

---

### 4. Architecture Overview (Vite + Electron)

This project uses a standard **Electron + Vite + React** architecture:

*   **Main Process (`electron/main.js`):** The entry point of the Electron app. It creates the browser window, handles system integration (like file system access via `ipcMain`), and manages the application lifecycle. In production, it loads the `index.html` from the `dist/` folder.
*   **Renderer Process (React):** The UI of the application. Vite is used as the build tool to bundle the React code.
*   **Preload Script (`electron/preload.js`):** Acts as a secure bridge between the Main and Renderer processes. It exposes a specific API (`window.electron`) to the React frontend using `contextBridge`, allowing the UI to trigger backend actions (like `selectFolder` or `saveProject`) via IPC channels.
*   **Video Rendering (`electron/ffmpeg-handler.js`):** A dedicated module referenced in `main.js` that handles video rendering tasks using `fluent-ffmpeg`.

---

### 5. macOS Build & Notarization Deep Dive

Packaging a macOS app for distribution outside the App Store requires **Code Signing** and **Notarization** to satisfy Apple's Gatekeeper security.

#### The Configuration
The `package.json` build configuration for Mac specifies:
*   `hardenedRuntime: true`: Required for notarization.
*   `entitlements`: Points to `electron/entitlements.mac.plist`.
*   `afterSign`: Point to `scripts/notarize.js`. This script runs *after* the app is signed but *before* it is packaged into a DMG.

#### Script 1: Automated Notarization (`scripts/notarize.js`)
This Node.js script allows `electron-builder` to automatically notarize the app during the build process.

1.  **Platform Check:** It ensures it only runs when building for macOS (`darwin`).
2.  **Environment Check:** It checks if the build is running in a CI environment (`process.env.CI`) or if `FORCE_NOTARIZE` is set. If neither is true, it skips notarization to save time during local testing.
3.  **Credential Loading:** It loads `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` from the `.env` file (via `dotenv`). Alternatively, it accepts a keychain profile.
4.  **Execution:** It uses the `@electron/notarize` package to submit the `.app` bundle to Apple's notary service using the `notarytool` tool.

#### Script 2: Manual DMG Utility (`scripts/notarize-dmg.sh`)
This is a standalone Bash script for manually creating and notarizing a DMG file from a signed `.app`.

1.  **Verification:** It verifies the `.app` exists and checks its code signature using `codesign --verify --deep --strict`.
2.  **DMG Creation:**
    *   Creates a temporary writable DMG.
    *   Copies the `.app` and a symlink to `/Applications` into it.
    *   Converts the temporary DMG to a compressed, read-only format (UDZO) using `hdiutil`.
3.  **Submission:** It submits the resulting DMG to Apple using `xcrun notarytool submit`. It requires `APPLE_ID`, `TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD` (or a keychain profile) to be set as environment variables.
4.  **Stapling:** Once approved, it "staples" the notarization ticket to the DMG using `xcrun stapler staple`, allowing the app to be verified even when offline.

#### Required Environment Variables
For either script to work, the following must be set in your terminal or `.env` file:

*   `APPLE_ID`: Your Apple ID email.
*   `APPLE_APP_SPECIFIC_PASSWORD`: An app-specific password generated at appleid.apple.com (not your login password).
*   `APPLE_TEAM_ID`: Your 10-character Team ID from the Apple Developer portal.
*   `NOTARYTOOL_KEYCHAIN_PROFILE` (Optional): If you have stored credentials in your local keychain to avoid exposing cleartext passwords.
