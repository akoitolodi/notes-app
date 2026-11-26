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
