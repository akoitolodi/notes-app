# Notes by Bai (v1.5.0)

An offline-first Android, desktop & web notes app styled like iOS Notes — universal enough for class study, personal journaling, curiosity deep-dives, and coding — enhanced with a fast AI layer, answerable & printable bond-paper exams, PDF/PPTX importing, SM-2 spaced repetition, voice dictation, and an optional offline Dev & IT Toolkit.

## Features

- **Multi-Life Modes & PIN-Locked Private Vault**: Switch folders or notes between **Study**, **Journal** (calm reflection, zero quizzes/mistake flags), **Explore** (curiosity & myth-checking), and **Code**, plus a salted SHA-256 PIN lock hiding private folders from Search, All Notes & Daily Review.
- **Passwordless AI Provider Lock**: Auto-locks your verified AI provider & key (with `Connected in X.Xs` latency check) and unlocks via a tactile 1.5s Press-and-Hold — no extra password needed.
- **Answerable & Printable Bond-Paper Exam Builder**: Convert any note or folder into an authentic `8.5" × 11"` exam paper combining any mix & count of 8 test types (MC, True/False, Identification, Matching, Enumeration, Problem Solving/Code, Scenario, Essay) — answerable right on screen with instant offline auto-grading + exportable to PDF/Print with a separate Answer Key page.
- **Universal Rich Writing & Second-Brain Links**: Syntax-highlighted fenced code blocks (with 1-tap Copy & live-streaming Trace/Debug), Markdown tables, `[[Wiki-Links]]` with autocomplete & cross-folder backlinks, KaTeX math (`$E = mc^2$`), and pluggable Grammar & AI Writing Polish (free zero-key LanguageTool, optional Grammarly EDU Writing Score / Sapling keys, and 1-tap AI Polish).
- **Optional Dev & IT Toolkit Add-on**: Clean, separate, toggleable offline toolkit (IPv4/CIDR Subnet Calculator, Base/Bitwise Converter, JSON/Base64/URL/JWT Inspector, Live Regex Tester, IT Cheat Sheets & Tech templates).
- **Fast Free-Tier Resilient AI**: TTFT stall watchdog with automatic backup-provider failover, live reasoning progress indicator, single-pass 35-line scanning, Cross-Note Local RAG, Deep Think (Solve → Verify), zero-key Research (Wikipedia + OpenAlex), and Socratic coaching.
- **Offline-First Core**: Dexie v4 IndexedDB storage, PDF/PPTX offline importer, SM-2 Daily Review & streaks, Voice-to-Notes dictation, OCR & photo explanations, Annotations, JSON Backup/Restore, custom adaptive Android icon, and Day/Night splashes.

## Quick Start

```bash
npm install
cp .env.example .env    # Optional: needed only for local/Termux backend mode
npm run build
npm run dev             # Serves built app + /api/* on http://127.0.0.1:8080
```

For hot-reload frontend development alongside the backend:

```bash
# Terminal 1 (API backend on 127.0.0.1:8080)
npm run dev

# Terminal 2 (Vite dev server on localhost:5173, proxies /api -> 127.0.0.1:8080)
npm run dev:web
```

## Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start the Express backend server (`127.0.0.1:8080` by default) |
| `npm run dev:web` | Start Vite hot-reload dev server (`localhost:5173`) |
| `npm run build` | Production web build into `dist/` |
| `npm test` | Run Vitest unit & IndexedDB test suite |

## Environment Variables (Server Mode)

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `FREELLMAPI_API_KEY` | — | API key for the upstream OpenAI-compatible AI provider |
| `FREELLMAPI_BASE_URL` | `http://127.0.0.1:3001/v1` | Upstream OpenAI-compatible base URL |
| `FREELLMAPI_MODEL` | `auto` | Default model ID |
| `PORT` | `8080` | Express listening port |
| `HOST` | `127.0.0.1` | Bind address (set `0.0.0.0` explicitly for LAN access) |
| `CORS_ORIGIN` | local origins | Comma-separated allowed origins (or `*` for open LAN) |

## Android APK

Pushes to `main` run tests, build the Vite bundle, sync Capacitor, and produce a signed release APK via `.github/workflows/build-apk.yml`.
