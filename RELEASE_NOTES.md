## What's New in Notes by Bai v1.8.0

### Canvas-Style Course Dashboard & AI-Indexed Module Library
- **Course Dashboard**: Visual colored Course Cards mirroring Canvas LMS with **1-Tap Auto-Discover** from your synced Canvas `.ics` / `.atom` feeds and Timetable.
- **Full Course Workspaces (`Home`, `Modules`, `Posts`, `Tasks`, `Course AI`)**:
  - Organize manually uploaded **`.pdf`**, **`.pptx`**, **`.docx` (NEW offline Word extractor!)**, **pasted Canvas Module Pages (HTML → clean Markdown)**, and **Batch Multi-Screenshot OCR** into collapsible Modules (`Module 1`, `Module 2`, …).
  - **Course AI Tutor (BM25 Chunked RAG)**: Chat, generate Study Guides, build Flashcards & Quizzes, or generate **Bond-Paper Practice Exams** grounded strictly in THAT course's uploaded files & modules — with slide/page citations and Exam-Week checkboxes to pick only the chapters covered in your exam!
- **Android "Share to Notes by Bai"**: Share a `.pdf`, `.pptx`, `.docx`, screenshot, or Canvas/Google Chat link straight from Chrome or Google Chat into Notes by Bai in 1 tap.

### Persistent Due-Date & Announcement Notifications
- **Native Android Local Notifications (`@capacitor/local-notifications`)**: Automatically schedules offline reminders **24 hours before due**, **3 hours before due**, **7:00 AM on Exam Day**, and instant notifications when new Canvas announcements arrive — plus an optional **Persistent Sticky Reminder** for Due Today / Overdue tasks that stays pinned until marked Done.
- **Persistent In-App Reminder Banner**: Pinned alert card on Folders Home showing overdue tasks, due-today deadlines, and unread announcements with 1-tap `View Tasks`, `Mark Posts Read`, or `Snooze 1h`.

### Slow Internet Mode & Timeout Protection
- **Adaptive Slow Internet Mode** (auto-detected on 2G/3G/Save-Data or toggleable in Settings): Widens AI first-byte watchdogs (`45s–60s`), retries dropped connections with exponential backoff (`1s → 3s`) across Canvas sync and AI calls, and tightens RAG chunks so AI streams fast even on weak campus Wi-Fi or mobile data.

> **Update Note**: Install `Notes-by-Bai.apk` directly over your current version (do not uninstall) — Dexie v7 is strictly additive, so all notes, vault records, schedules, and API keys stay 100% intact.
