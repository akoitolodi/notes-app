# Notes by Bai (v1.9.0)

An offline-first Android, desktop & web notes app styled like iOS Notes — built for class study, Canvas LMS & school planning, personal journaling, curiosity deep-dives, and coding — enhanced with a fast AI layer, Study Commute audio, answerable & printable bond-paper exams, Learn Coding Studio + Algorithm Visualizer, 2D Math Grapher, SM-2 spaced repetition, and Zero-Cloud BaiDrop sync.

## Features

- **School Planner & Canvas LMS Hub**: Interactive Month Calendar, Exam Countdown, Canvas Calendar Feed (`.ics`) sync (works even when school admins block Access Tokens), Quick-Paste Announcement date detector, Weekly Class Timetable, PH GWA / US GPA Target Final Calculator, and 16-Week Study Activity Heatmap.
- **Study Commute Audio & Reverse Feynman**: Offline Read Aloud + 2-Voice AI Study Podcast on notes, Hands-Free Audio Flashcards in Daily Review, and **Teach the AI** Reverse Feynman roleplay integrated with DeepTutor Persistent Learner Memory.
- **Learn Coding Studio & Algorithm Visualizer**: 18 languages via live open-source lessons, Exercism challenges, live multi-language code runner, and 100% offline Sorting / Binary Search / BFS-DFS-Dijkstra / Recursion Call-Stack visualizations.
- **Multi-Life Modes & Hidden PIN Vault**: Switch folders or notes between **Study**, **Journal**, **Explore**, and **Code**, plus a salted SHA-256 Hidden Vault with a permanent Zero-AI `Passwords & Keys` folder.
- **Answerable & Printable Bond-Paper Exam Builder**: Convert any note or folder into an authentic `8.5" × 11"` exam paper combining any mix & count of 8 test types — answerable right on screen with offline auto-grading + PDF/Print export with a separate Answer Key page.
- **Dev & IT Toolkit + Offline 2D Math Grapher + Bug Log**: Offline 2D Function Grapher (with 1-tap Save Graph to Note), "Bugs I Solved" Stack-Trace Debugger, IPv4/CIDR Subnet Calculator, Base/Bitwise Converter, JSON/Base64/URL/JWT Inspector, Live Regex Tester, and IT Cheat Sheets.
- **Zero-Cloud BaiDrop Share & Local Wi-Fi Sync**: Share single notes (with flashcards & quizzes) offline via `.bai.json` or `BAIDROP1:` codes, or run 1-tap PC↔Phone Wi-Fi sync (strictly excluding Hidden Vault & `Passwords & Keys`).
- **Offline-First Core & Themes**: Dexie v6 IndexedDB storage, OLED True-Black theme, Blank/Ruled/Dot/Graph paper textures, PDF/PPTX offline importer, SM-2 Daily Review, Voice-to-Notes dictation, OCR & photo explanations, Annotations, and JSON Backup/Restore.

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
