## What's New in Notes by Bai v2.0.2

### 1. Native Android Voice Dictation Fix
- **Built-In `BaiNativeSpeech` Bridge**: Fixed live Voice Dictation not picking up microphones inside Android WebView! Now binds Android's native `SpeechRecognizer` directly (supporting English, Filipino `fil-PH`, and Auto language, live interim speech, continuous auto-restart across pauses, and proper Android 11+ `<queries>` recognition discovery).

### 2. Clean Note-to-PDF Export & Adaptive PDF Designs
- **Zero Markdown Leaks (`#`, `*`, `**`, backticks)**: Redesigned PDF rendering parses headings, bold/italic text runs, checklists (vector drawn), lined Markdown tables, shaded code boxes, callout quotes, and readable Unicode math symbols cleanly — in both Note PDFs and Exam Study Pack PDFs.
- **Adaptive PDF Templates**: Choose **Auto** (detects note style automatically) or pick **Academic**, **Cheat Sheet**, **Code & Tech**, **Editorial**, or **Minimal** right inside Share & Export.
- **Fixed Android PDF Share & Direct Save**: Uses Capacitor Android FileProvider `files: [uri]` attachment sharing cleanly, ignores user cancel gracefully, and adds 1-tap **Save PDF to Phone Documents** (`Documents/NotesByBai`).

### 3. Clean OCR Text Output
- **No More Stray Markdown in Scans**: Vision OCR prompts & `cleanOcrText()` strip unwanted `#`, `**`, `*`, backticks, code fences, and AI preambles while preserving math (`3 * 4`) and plain lists (plus fixed `ocrImage` calls in Courses & Batch Import).

### 4. 100% Offline User Pattern Recognition Engine
- **Smart Auto-File & Related Notes**: Multinomial Naive Bayes folder classifier suggests filing blank/general notes (`Move to <Subject>`) + offline cosine similarity spots overlapping older notes right in the Smart Strip (Zero-AI Vault & locked folders strictly excluded).
- **Your Study Patterns Card**: Inside **Daily Review**, view your peak study window, strongest day of week, note-taking habit, weak-topic priorities, and recurring Bug Log patterns — 100% offline.

### 5. Dedicated "Themes & Palettes Studio"
- Open **Themes & Palettes** from the Home top bar (`🎨`) or Settings → Appearance to mix & match **12 full surface themes** (5 Light + 7 Dark including *Warm Ivory*, *Matcha Sage*, *Sakura Mist*, *Nordic Ice*, *Sepia Book*, *Deep Obsidian*, *OLED True Black*, *Midnight Ocean*, *Catppuccin Mocha*, *Tokyo Night*, *Forest Night*, *Dracula Plum*) with **12 dual-tone color combinations**, paper textures, and live preview!

> **Update Note**: Install `Notes-by-Bai.apk` directly over your current version (do not uninstall).
