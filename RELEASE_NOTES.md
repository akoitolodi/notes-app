## What's New in Notes by Bai v2.0.4

### 1. Major App & Bundle Optimization
- **~70% Smaller Initial Launch**: Code-split secondary screens, modals, `NotesListScreen`, `NoteEditor`, and KaTeX out of the initial boot path + idle-prefetch after Home loads so opening the app feels crisp and instant.
- **Asset & Dead-Weight Removal (~1.15 MB pruned)**: Stripped redundant legacy KaTeX `.ttf`/`.woff` fonts (keeping modern `.woff2` only), stubbed unused optional jsPDF dependencies (`html2canvas` & `canvg`), and targeted `es2020`.
- **Android R8 Shrinking (`versionCode 56`)**: Enabled `minifyEnabled true` + `shrinkResources true` in release Gradle builds with ProGuard keep rules protecting `BaiNativeTts`, `BaiNativeSpeech`, and Capacitor plugins.
- **Zero-Lag Editor & Lightweight DB Index**: Added shared `getNoteIndexLite()` cache, stopped full `db.notes` scans while typing, stopped triggering full Home refreshes during paragraph autosaves, memoized Markdown/code cards + `250`-entry KaTeX LRU cache, used `useDeferredValue` for global search, deduplicated `plannerItems` reads, and added `content-visibility: auto` on long lists.

### 2. Improved Annotate Colorization
- **Studio Ink vs. Pastel Highlighter Palettes**: Separate curated palettes for ink (`Pen`, `Arrow`, `Line`, `Text`) and luminous pastel `Highlighter`, each with **remembered tool colors** so switching between Highlighter and Pen keeps your color!
- **Adjustable Stroke Opacity & Recent Custom Colors**: Pick `25% | 40% | 65%` Highlighter opacity (`50% | 80% | 100%` for ink), save up to 5 recent custom hex colors, and view an active-color indicator pill in the toolbar.

### 3. Custom Note Fonts (`Times New Roman`, `Georgia`, `Garamond`, etc.)
- **8 Zero-Download Note Typefaces**: Choose **Clean Sans**, **Times New Roman**, **Georgia**, **Garamond**, **Palatino**, **Friendly Rounded**, **Courier Typewriter**, or **Code Mono** inside **Themes & Palettes Studio** or **Settings → Appearance**.
- **Applied Everywhere + PDF Support**: Updates Editor, Clean Visual Edit Mode, Read Mode, Theme Live Preview, and Note PDF exports cleanly while keeping code blocks monospace.

> **Update Note**: Install `Notes-by-Bai.apk` directly over your current version (do not uninstall).
