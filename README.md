# AI Class Notes

A phone notes app styled like the iOS Notes app. When you tap **Save**, the AI
reads the whole note and explains it beside what you wrote, so you learn while
you take notes.

## Features

- **Explain on save** — AI reads the whole note and attaches a short
  explanation to each key line, term or equation
- **Three explanation views** — slide-up panel (default), inline under lines,
  separate swipe page; your choice is remembered
- **Explain simpler / Give example** — per-line AI re-scan, results persist in
  all views
- **Mistake check** — flags possible errors with a suggested fix you can
  accept or ignore (ignored/accepted state persists)
- **Study mode** — flashcards (tap to flip) and multiple-choice quizzes
- **Exam summary** — one-page summary, cards and quiz for a whole folder
- **Folders, search, pin, swipe actions** — full notes app basics
- **Offline-first** — notes live in IndexedDB on the phone; dark mode;
  installable PWA; Android APK via GitHub Actions

## Stack

React + Vite · Express (dev server + serverless functions in `api/`) ·
IndexedDB (Dexie) · Capacitor (Android) · AI via any OpenAI-compatible API

## Setup

```bash
npm install
cp .env.example .env    # then fill in FREELLMAPI_API_KEY
npm run build
node server.js          # serves the app + /api/* on port 8080
```

For development with hot reload: `npx vite` (port 5173, proxies `/api` to
port 3002) plus `node server.js`.

### Environment variables

| Variable | Purpose |
|---|---|
| `FREELLMAPI_API_KEY` | API key for the AI provider (server-side only) |
| `FREELLMAPI_BASE_URL` | OpenAI-compatible base URL (default `http://127.0.0.1:3001/v1`) |
| `FREELLMAPI_MODEL` | Model id (default `auto`) |
| `PORT` | Port for the Express server (default `8080`) |

The AI key lives **only** on the server; the front end calls `/api/*` and never
touches the key.

## Android APK

Pushes to `main` trigger a GitHub Actions build
(`.github/workflows/build-apk.yml`) that produces a debug APK artifact.
Releases attach the APK — install it and the app talks to the on-device
backend at `http://127.0.0.1:8080` (see `src/config.js`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Express server (port 8080) |
| `npm run build` | Production web build to `dist/` |
| `npx vite` | Dev server with hot reload |
| `node qa-review.js <model>` | Ask an AI to review the codebase for bugs |
