Asking gemini-3.5-flash to review 8 files...

## 1. BUGS FOUND

### `src/components/NoteEditor.jsx:65` — `scanNote` Parameter Type Mismatch (Crash on Save)
* **What the bug is:** `scanNote` in `lib/ai.js` is defined expecting a single destructured object parameter: `scanNote({ note, subject, changedLines })`. However, `NoteEditor.jsx` calls `scanNote(body, note.subject || 'General', changedLines)` passing positional arguments. Inside `scanNote`, the first argument `body` (a string) is assigned to the destructured object, making `note` `undefined`. Calling `note.split('\n')` immediately throws `TypeError: Cannot read properties of undefined (reading 'split')`.
* **How to reproduce:** Open any note, switch to Edit mode, type text, and tap **Save**. The app crashes with an uncaught runtime error.
* **Severity:** Critical

---

### `src/components/NoteEditor.jsx:210` & `src/App.jsx:66` — Missing Navigation Back to Notes List (User Trapped)
* **What the bug is:** When viewing a note in `NoteEditor` (Read mode), the top-left button is labeled `‹ Edit`. There is no back button or navigation handler to return to `NotesListScreen`. `App.jsx` renders `<NoteEditor>` without passing an `onBack` prop.
* **How to reproduce:** Navigate from Folders → Notes List → Note Editor. Try to navigate back to the note list. It is impossible without refreshing the browser page.
* **Severity:** Critical

---

### `src/components/NoteEditor.jsx:81` — `scanLine` Parameter Mismatch (Per-Line Re-scan Fails)
* **What the bug is:** `scanLine` in `lib/scanLine.js` expects `{ note, line, request }`, but `handleLineRequest` calls `scanLine(body, block.text, request)` with positional arguments. `line` evaluates to `undefined`, causing `scanLine` to throw `Error: No line to explain`.
* **How to reproduce:** Tap "Explain simpler" or "Give example" on any line inside the editor or panel.
* **Severity:** High

---

### `src/components/NoteEditor.jsx:19-20` — Frontend Bundling Node/Server AI Modules (`process` ReferenceError)
* **What the bug is:** `NoteEditor.jsx` imports `scanNote` and `scanLine` directly from backend API helper files (`../api/scan` / `lib/ai.js`). These modules reference `process.env.FREELLMAPI_API_KEY`. In a browser Vite production build, `process` is undefined, throwing `ReferenceError: process is not defined` when executed. Frontend code must call backend HTTP endpoints (`/api/scan`), not import server code directly.
* **How to reproduce:** Run Vite build (`vite build && vite preview`) and attempt to trigger any scan operation from the UI.
* **Severity:** High

---

### `api/scan.js:11-20` — Unreachable Route Handler in Serverless File
* **What the bug is:** Line 11 evaluates `if (req.method === 'POST')` and returns the output of `scanNote`. The subsequent check `if (req.method === 'POST' && req.url === '/api/scan-line')` on line 20 can never be reached.
* **How to reproduce:** Send a `POST` request to `/api/scan-line` targeting this serverless entrypoint. It executes `scanNote` instead of `scanLine`.
* **Severity:** High

---

### `src/components/NoteEditor.jsx:106` — Missing `setBlocks` in `applyCorrection` (UI State Desync)
* **What the bug is:** When `applyCorrection` runs, it updates IndexedDB via `updateNote(note.id, { body: newBody, blocks: updated })`, but omits `setBlocks(updated)` to update React state. The state in memory retains the un-cleared `mistake` object until component remount.
* **How to reproduce:** Tap "Accept fix" on a detected mistake line. The text updates in the body, but the inline mistake warning remains visible on screen.
* **Severity:** Medium

---

### `src/components/SlideUpPanel.jsx:32-45` — Touch Handlers Intercept Internal Content Scrolling
* **What the bug is:** `SlideUpPanel` attaches `onTouchMove` to the root panel container `div.panel.open`. When a user attempts to vertically scroll through long content or the "All lines in this note" list inside `.panel-content`, the root `onTouchMove` handler fires and drags the bottom sheet height instead of scrolling the inner text container.
* **How to reproduce:** Open the panel on a note with multiple lines, open to 60% height, and try to drag-scroll down inside the content area. The whole sheet moves down/closes instead of scrolling the list.
* **Severity:** Medium

---

## 2. MISSING BEHAVIOR

1. **Graceful Offline Save & Queueing:** IndexedDB is used for offline storage, but saving a note while offline immediately triggers an unhandled network fetch error. The app should detect `navigator.onLine === false`, save locally, mark the note as `scanPending: true`, and display a visual badge.
2. **Line Deletion/Insertion Alignment Strategy:** The app links AI explanations to fixed array line numbers (`line-1`, `line-2`). If a user inserts or deletes lines in the middle of a note, all subsequent block IDs point to the wrong text lines. Line index matching should be replaced by content hashing or anchor IDs.
3. **Note & Folder Deletion UI:** `db.js` exposes `deleteFolder` and `deleteNote`, but neither `FoldersScreen`, `NotesListScreen`, nor `NoteEditor` expose buttons or swipe actions to call these functions. Once created, data cannot be deleted.
4. **Dark Mode Support:** CSS variables (`var(--bg)`, `var(--text)`) are used throughout components, but no theme switcher exists and no default dark mode media query (`@media (prefers-color-scheme: dark)`) or root theme class toggler is implemented.
5. **Request Abort / Timeout UX:** AI scans take up to 90 seconds (hardcoded timeout). If the API hangs, the UI remains disabled with "Scanning..." and gives the user no mechanism to cancel or retry.

---

## 3. TEST CASES

1. **Save & Scan:** Tap Save in Note Editor -> Verify full-note AI scanning completes, switches UI to Read mode, and populates dot indicators on lines with explanations.
2. **Offline Save:** Enable Airplane Mode, edit note body, and tap Save -> Verify note content updates in IndexedDB locally without throwing an unhandled runtime exception.
3. **Panel Snap Drag:** Open SlideUpPanel and drag the handle up and down -> Verify sheet snaps smoothly to 25%, 60%, and 95% viewport height snap points.
4. **Inline Explanation Toggle:** Tap a line dot while in Inline view -> Verify a collapsed 90-character summary expands directly beneath the line showing full text and action buttons.
5. **Swipe View Page Snap:** Select Swipe view control and swipe left -> Verify viewport snaps horizontally to page 2 displaying cards for all line explanations.
6. **Study Mode Launch:** Tap book icon 📚 in Note Editor header -> Verify study screen opens with flashcards and multiple-choice quiz items derived from the current note.
7. **Folder Creation:** Tap "+ New Folder" on Folders screen, enter title, and submit -> Verify new folder renders in list with correct title and initial note count of 0.
8. **Note Search:** Enter search term into search input on Notes List -> Verify list updates immediately to display only notes matching title or body text.
9. **Accept Fix Correction:** Tap "Accept fix" on a line flagged with a mistake -> Verify mistake text is replaced in the note body and mistake warning banner dismisses.
10. **System Dark Mode Adapting:** Enable device dark mode setting -> Verify app background, sheet colors, and navbar contrast adapt automatically to dark theme tokens.

---

## 4. CODE QUALITY

### Score: 3 / 10

### 3 Specific Improvements:

1. **Decouple Client Code from Server AI Implementation:**
   Replace direct imports of server modules (`../api/scan`, `lib/ai.js`) inside `NoteEditor.jsx` with a dedicated client API module (`src/api/client.js`) that performs standard HTTP `fetch('/api/scan', ...)` calls. Keep environment key reads exclusively on the backend server layer.

2. **Consolidate Editor Component State:**
   `NoteEditor.jsx` manages 12 individual `useState` instances alongside unsynchronized `useRef` objects (`savedRef`). Replace this state soup with `useReducer` to guarantee atomic state transitions for edit/read modes, line requests, and block updates.

3. **Isolate Bottom Sheet Touch Gesture Handling:**
   Refactor `SlideUpPanel.jsx` touch handlers so they are bound exclusively to `.panel-handle` or verify `e.target` scope. Use standard CSS `touch-action: pan-y` on `.panel-content` to prevent root gesture handlers from blocking content scroll behavior.
