## What's New in Notes by Bai v1.6.0

### Custom App Icon, Online Learn Coding Studio (18 Languages), DeepTutor Learner Memory, Writing Craft Coach & Zero-Empty-Response AI
- **New Custom App Icon & Day/Night Splash Screens**: Updated the Android adaptive launcher icon, round/legacy mipmap icons, Day/Night splashes, and PWA favicon with the custom **Notes by Bai** artwork.
- **Online Learn Coding Studio (18 Languages)**:
  - Fetches free, open-source lessons dynamically online from **Learn X in Y Minutes (`CC BY-SA`)** and real coding exercises from **Exercism Problem Specifications (`MIT`)**, caching opened modules locally in IndexedDB for fast offline review.
  - Supports **Python, JavaScript, TypeScript, HTML, CSS, C, C++, Java, C#, SQL (SQLite), PHP, Go, Rust, Kotlin, Swift, Bash, Ruby, and Dart**.
  - **Built-in Live Multi-Language Code Runner**: Instant offline JavaScript & live HTML/CSS preview + live cloud sandbox execution via **Codapi** (`api.codapi.org`, zero key needed) + automatic AI Virtual Compiler & Step-by-Step Tracer + Language Translator (`Python ↔ C++ ↔ Java ↔ JS ↔ Rust`) + MDN/Wikipedia CS Docs search + 1-tap **Save to Notes**.
- **DeepTutor-Inspired Persistent Learner Memory & Adaptive Tutoring**:
  - Automatically tracks weak concepts and mastered strengths across Flashcards, Bond-Paper Exams, and Learn Coding in local IndexedDB (strictly isolated from Hidden Vault & `Passwords & Keys`).
  - Feeds your personalized Learner Memory into **AI Chat**, **Dual-Loop Deep Think** (with 1-tap **"Practice similar"**), and **Exam Paper Builder**, plus an optional **Self-Hosted `HKUDS/DeepTutor` Server Bridge** in Settings.
- **Offline LaTeX- & Code-Safe Writing Craft & Style Coach**:
  - Instant offline Flesch-Kincaid readability score, sentence-rhythm variety score, repeated-phrase finder, passive-voice check, and 1-tap conciseness fixes inside Edit Mode's **Polish** tray — automatically protecting `$LaTeX$` equations and ````code```` blocks from edits.
- **Permanent Fix for "AI Returns Nothing"**:
  - Reasoning/thinking models (`Nemotron`, `DeepSeek-R1`, `Qwen3`, `Gemini 2.5`, `o4-mini`, `Claude 4.6`, `GPT-5`) now automatically receive boosted `max_tokens` (`4096–8192`) so they never run out of budget mid-thought, and empty responses automatically retry and fail over to your backup provider.

> **Update Note**: Install `Notes-by-Bai.apk` directly over your current version (do not uninstall) — Dexie upgrades seamlessly from v4 → v5 while keeping all notes, vault records, drawings, photos, and API keys 100% intact.
