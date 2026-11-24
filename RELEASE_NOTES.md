## What's New in Notes by Bai v2.0.7

### 1. Modern Offline Document Viewer (`PDF`, `DOCX`, `PPTX`, `MD`, `TXT`)
- **Tap to View Anywhere**: Attach PDFs, Word documents, PowerPoint decks, Markdown, or text files directly inside notes (via **File** in the Edit toolbar), preview immediately from **Import / Open With → View Now**, or open uploaded files inside **Course Modules** with a full modern reader UI.
- **PDF Canvas Reader**: HiDPI virtualized pages, pinch/button zoom, page scrubber, `Pages` vs `Clean Text` toggle, in-document search, and **Paper / Sepia / Night** reading themes.
- **Modern Slide Deck & Word Reader**: Interactive 16:9 PPTX slide deck with speaker notes & embedded images, plus rich DOCX reader with headings, bold/italic/code runs, tables, and embedded figures — 100% offline and lazy-loaded (0 bytes added to boot).

### 2. Instant Zero-White-Flash Launch & High Refresh Rate (90Hz / 120Hz+)
- **Zero Split-Second White Flash**: Synchronized Android splash/window/WebView background colors (`#F4F2EC` light / `#090A0E` dark + live `BaiNativeTheme` pref persistence) and pre-paint CSS `--boot-bg` in `index.html`.
- **90Hz / 120Hz / 144Hz Support**: `MainActivity` now requests your screen's highest native refresh rate on startup & resume alongside explicit hardware acceleration (`android:hardwareAccelerated="true"`), `requestAnimationFrame`-coalesced ink drawing, `touch-action: manipulation`, and card layout containment.

### 3. Fixes & Cleanups
- Fixed `"LocalNotifications.then() is not implemented on android"` by wrapping the dynamically imported Capacitor plugin in a non-thenable container.
- Moved **Find related notes** off the reading canvas into the **⋯ (More actions)** menu in Read Mode.

> **Update Note**: Install `Notes-by-Bai.apk` directly over your current version (do not uninstall).
