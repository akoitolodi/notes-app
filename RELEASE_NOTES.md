## What's New in Notes by Bai v1.9.1

### Native Android Text-to-Speech Fix (Study Commute Audio & Hands-Free Cards!)
- **Fixed `"Web Speech TTS is unavailable"` on Android APK**: Android System WebView does not expose the browser `speechSynthesis` API, so Study Commute Audio couldn't play inside the Android APK. Added a built-in native **Android `TextToSpeech` bridge** (`BaiNativeTts` in `MainActivity.java` + Android 11+ `<queries>` TTS binding in `AndroidManifest.xml`) so **Read Aloud**, **2-Voice Study Podcast** (distinct Host/Tutor pitch & `0.85x–1.5x` speed), and **Hands-Free Audio Flashcards** all work **100% offline** directly on your Android phone!

> Includes all `v1.9.0` features (White-Button Design Fix, Phone-First Course Module Android Share/Open-With + Multi-File Batch Upload + Public Google Docs/Slides Link Importer, Per-Course Grades + What-If Simulator + Semester GWA, Auto-Pinned Course Links, Assignment Workflow + AI Rubric Checker, Module Study Progress, Course Nicknames/Archive, and CHED Attendance Guard).
>
> **Update Note**: Install `Notes-by-Bai.apk` directly over your current version (do not uninstall).
