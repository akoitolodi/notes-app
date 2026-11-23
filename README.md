# AI Class Notes (v1.3.0)

An offline-first mobile & desktop notes app styled like iOS Notes, enhanced with an AI study layer that explains your notes line by line, flags mistakes, chats with streaming citations, and generates flashcards, quizzes, blanks, mnemonics, and exam packs.

## Features

- **Offline-first & Safe**: Notes, study progress, drawings, and image Blob attachments live locally in IndexedDB (Dexie v4), with auto-save, 30-day Trash recovery, and full JSON Backup & Restore.
- **Rich Markdown + LaTeX Math**: Headings, bold/italic, code, interactive `- [ ]` checklists, `#tags`, and KaTeX equations (`$E = mc^2$` / `$$...$$`), plus a mobile formatting toolbar.
- **Explain on Demand**: Smart LCS line diffing remaps existing explanations when you insert/move lines and scans only changed lines. Re-explain any line **Simpler** or with an **Example**, or accept/ignore mistake suggestions.
- **Streaming AI Tutor & Multi-Step Research**: Grounded in your note **and** sibling folder notes (offline Cross-Note Local RAG), with **Deep Think** (2-pass Solve → Skeptical Verify), **Research** (zero-key Wikipedia + OpenAlex academic papers + optional Tavily with clickable citations & 1-tap Save as Note), and **Socratic** coaching mode.
- **Vision OCR & Photo Explanations**: Snap or attach photos, zoom full-screen, extract text via OCR, or ask AI to explain diagrams and slides.
- **Annotations**: Pen, highlighter, eraser, arrows, lines, and inline text labels with adaptive light/dark ink and Undo/Redo/Clear.
- **Critical Thinking & Study Mode**: Interactive Flashcard Flip Deck with spaced-repetition mastery tracking, higher-order scored Quizzes, type-to-check Fill-in-the-Blank Cloze, **Challenge My Notes** logical & assumption audit, **Feynman Technique Coach**, Mnemonics, Answer Grader, Weakness Detection, and Folder Exam Summaries + Predicted Exam Questions.
- **Free-Tier Resilient AI Backends**: Run directly against Groq, Google Gemini (AI Studio free tier), OpenRouter, OpenAI, Cerebras, Mistral, NVIDIA, Kilo, or any OpenAI-compatible API with automatic 429 retry & backup-provider auto-failover — or relay through your own local/Termux Express server or Vercel serverless functions.
- **Unicode PDF Export & Responsive UI**: Export notes or exam study packs to A4 PDF, with automatic 2-pane split view on tablets/desktops, Dark Mode, and 5 WCAG-accessible accents.

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
