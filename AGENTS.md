# Notes by Bai — Agent Project Guide

- **Repo & Path**: `C:\Users\tuaso\Downloads\notes-app-main` (`https://github.com/akoitolodi/notes-app.git`, branch `main`)
- **OS / Shell**: Windows PowerShell — do **not** use `&&` (`rg` and `gh` CLI are not installed). Chain commands with `;` and gate with `if ($LASTEXITCODE -eq 0) { ... }`. Use `Select-String` instead of `rg`.

## Non-Negotiable App Invariants
- **Android Application ID**: `com.philipjohn.aiclassnotes` (`android/app/build.gradle`)
- **Capacitor Scheme**: Keep `androidScheme: "http"` and IndexedDB name `'ai-class-notes'` intact so existing user notes/settings never wipe on APK upgrades.
- **Zero-AI Vault**: Notes/folders with `mode === 'vault'`, `isSystemVault`, or `isDecoyVault` must never be sent to AI or leaked across `'locked'` / `'decoy'` / `'real'` vault sessions.
- **Boot Performance**: After `npm run build`, inspect `dist/index.html` and verify modulepreloads remain lean (`index`, `dexie`, `react`, and main CSS only — keep PDF/KaTeX/editors/screens lazy-loaded).

## Standard Release & Verification Workflow
- **Version Bump Locations** (always update all 4 together on a release):
  1. `package.json` (`version`)
  2. `android/app/build.gradle` (`versionCode` +1, `versionName`)
  3. `public/sw.js` (`CACHE = 'ai-class-notes:vXX'`)
  4. `src/components/SettingsScreen.jsx` (footer version label)
- **Local Verification**: `Set-Location notes-app-main; npx vitest run; if ($LASTEXITCODE -eq 0) { npm run build }`
- **Mobile UI Check**: Use `vite preview --host 127.0.0.1 --port 4173` at `390x844` when UI layout/CSS/interactions changed (kill preview daemon after).
- **CI / APK Verification** (pushes to `v*` tag trigger `Build & Release Android APK`):
  - Check via `curl.exe -s -H "Accept: application/vnd.github+json" "https://api.github.com/repos/akoitolodi/notes-app/actions/runs?per_page=3"`
  - Verify `Notes-by-Bai.apk` via `"https://api.github.com/repos/akoitolodi/notes-app/releases/tags/vX.Y.Z"`

## Roadmap Note
- **GitHub Pro + Student Pack (`v3.0.0`)**: Azure `F0` Neural TTS / OCR, Azure AI Foundry preset, Private Cloud Backup / Short-Link Gist sync, In-App Updater, and the **Android Home Screen Widget** are deferred to `v3.0.0` (tracked at `C:\Users\tuaso\.gemini\antigravity\brain\a58d3de6-76f2-49de-afb9-adfef287dc77\v2.1.0_student_pack_plan.md`).
