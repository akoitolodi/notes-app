## What's New in Notes by Bai v2.5.0

### 1. Smart Task-Based AI Router (`BAI-Route`) & Deep Think Auto-Switch
- **Task-Aware Free Routing**: Automatically routes requests by task (`fast`, `balanced`, `code`, `reasoning`, `syllabus`, `vision`) across free-tier models (both within 1 provider key and across multiple saved keys) using live latency, RPM load spreading, and cooldown health.
- **Balanced Deep Think Fallback**: Adds stall detection (~12–14s, widened on Slow Internet Mode) to both streaming and non-streaming Deep Think calls, seamlessly switching to backup reasoning models or fast reasoning-boosted models when slow or unavailable.
- **Smart Task Routing Toggle**: Enabled by default in **Settings → AI Backend** (turn off anytime to pin manually).

### 2. Free-Only LLM Presets
- Removed paid-only presets (**OpenAI**, **DeepSeek**) and auto-migrates legacy selections cleanly to saved free-tier providers (**Groq**, **Google Gemini**, **OpenRouter**, **Cerebras**, **Mistral**, **NVIDIA**, **Kilo**, **SambaNova**, **GitHub Models**, **HuggingFace**, or **Custom**).

### 3. Full-Block Code Wrapping & Selection Support
- Upgraded unfenced code detection with a **Smart Full-Block Boundary Engine** that tracks `{}`, `()`, `[]` delimiter balance, bridges blank lines/comments, and reads & wraps entire multi-function programs — plus respects explicit highlighted text selections.

### 4. Redesigned 4-Tab Editorial-Glass UI & Top Announcements Spotlight
- **4-Tab Navigation**: Clean frosted bottom bar on mobile and left rail on tablets/desktops (**Notes**, **Courses**, **Planner**, **Tools**).
- **Announcements Front & Center**: Elevated **Announcements Spotlight** card right at the top of Notes Home (with unread count, 1-tap Mark Read, Sync, and View All), followed by **Recent & Pinned** cards, Quick Capture, and a **2-Column Subject Folder Grid**.

### 5. AI Syllabus Studio & Hands-On Practical Labs
- **Full-Semester Syllabus Analyzer**: Upload PDF, DOCX, PPTX, photo OCR, or pasted text to extract weekly modules, objectives, grading weights, and exam dates (with 1-tap sync to Courses, Grades & Calendar).
- **Accuracy-Verified Sources + Hybrid 3-Tier Practical Labs**: Filters homonyms across Wikipedia, Wikibooks, OpenAlex, MDN, and optional Tavily, pairs theory with hands-on labs (native Code/Grapher/Logic/NetLab/Algo labs, live Formula Calculators & Case Simulators, and on-demand sandboxed custom HTML/JS simulators), and verifies understanding with an **Applied Mastery Gate**.

> **Update Note**: Install `Notes-by-Bai.apk` directly over your current version (do not uninstall).

---

## What's New in Notes by Bai v2.4.0

### 1. Code Block Wrapping & Smart Output Fixes
- **Preserved Newlines & Quotes in Code Blocks**: Fixed Clean Edit Mode `<pre>` serialization (`extractPreCodeText`) and Enter/Paste handling so wrapping C/C++/Python/JS code never squishes lines together or breaks quotes (`'`, `"`).
- **Clean Scrollable Smart Output Drawer**: Fixed Step-by-Step AI math/code output cards overflowing over the bottom Smart Bar, plus wrapped long API error callouts cleanly on narrow screens.

### 2. Free-Only Live Models, 1-Tap Reasoning Picker & New Providers
- **DeepSeek, SambaNova, GitHub Models & HuggingFace**: Added official OpenAI-compatible presets alongside Groq, Gemini, OpenRouter, Cerebras, Mistral, NVIDIA, and Kilo.
- **Free vs All Filter + Pricing/Thinking Badges**: Live `/models` refresh automatically sorts free models first, shows `FREE`/`PAID`/`THINK` tags, and lets you filter to **Free Only** so you never accidentally hit HTTP 402 paid-model errors (with clear HTTP 402 guidance + backup failover).
- **1-Tap Primary & Reasoning Model Picker**: Switch between **Primary** and **Reasoning** right above the model chips and tap any model to assign it — no more manually typing reasoning model IDs.

### 3. Fast Line Explain & Highlight Partial Selection
- **Compact Context Explain (~1–2s)**: Tapping any line in Read Mode now uses a lightweight nearby context window instead of rescanning the whole note.
- **Explain Selection**: Highlight any specific phrase or partial line in Read Mode and tap **Explain Selection** to explain only the selected part.

### 4. Reliable Classroom Lecture Recording & Live Dictation
- **Native Android Audio Recorder (`BaiNativeRecorder`)**: Fixes Android WebView "Permission denied" errors in Groq Whisper mode even when mic permission is already granted, with automatic rolling **25s** chunk transcription for long teacher discussions.
- **Continuous Live Speech Recognition**: Reuses Android's `SpeechRecognizer` with fast 60ms restart, generous 4s silence timeouts, resilient transient-error retries, and automatic trailing-word flush on pause/stop so no spoken words are dropped midway.

### 5. Cleaner Copy Throughout
- Trimmed redundant filler text across Settings, Home, Smart Detect, and Lecture Recorder.

> **Update Note**: Install `Notes-by-Bai.apk` directly over your current version (do not uninstall).
